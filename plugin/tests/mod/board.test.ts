/** The crew board: query ranking and overflow, the decision log and its cap, the summary's scope and since-time, and the status line. */
import { expect, test } from "claude-code/testing";
import { addDecision, appendConflicts, ARCHIVE_KEY, decisionTextError, limitOf, queryText, readConflicts, readRepo, scopeRows, statusText, summaryText } from "../../src/mod/board.ts";
import { claimSpawn, liveClaims, newBook, stopAgent } from "../../src/mod/claims.ts";
import { allowed, registerAgentTools } from "../../src/mod/agents.ts";
import { settingsFrom } from "../../src/mod/config.ts";
import type { Decision, LiveClaim, RowLike, RunLike, Store, SummaryInput } from "../../src/mod/board.ts";
import type { Conflict } from "../../src/mod/claims.ts";

const T0 = Date.UTC(2026, 9, 13, 10, 0);

/** An in-memory store with the mod store's get and set; `data` is what it holds. */
function memStore(): Store & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return { data, get: async (key) => data.get(key), set: async (key, value) => void data.set(key, value) };
}

const claim = (path: string, holderName: string, since: number, task = ""): LiveClaim => ({ path, holderName, task, since });
const decision = (id: string, ts: number, paths: string[], text = "x", author = "main"): Decision => ({ id, text, paths, author, ts });
const row = (id: string, depth: number, name: string): RowLike => ({ id, depth, name, state: "working", task: `${name} task`, calls: 1, last: "Edit", elapsedMs: 1000 });

test("query lists claims first, then decisions on the path, then decisions on a parent folder, newest first", () => {
  const claims = [claim("/r/a/", "Ada", T0, "docs"), claim("/r/a/b.ts", "Bo", T0 + 5)];
  const decisions = [decision("D1", T0 + 1, ["/r/a/"]), decision("D2", T0 + 2, ["/r/a/b.ts"]), decision("D3", T0 + 3, ["/r/a/b.ts", "/r/c.ts"]), decision("D4", T0 + 4, ["/r/"])];
  const lines = queryText(["/r/a/b.ts"], claims, decisions, 40).split("\n");
  expect(lines.length).toBe(6);
  expect(lines[0]).toContain("claim /r/a/b.ts held by Bo");
  expect(lines[1]).toContain("claim /r/a/ held by Ada (docs)");
  expect(lines[2]).toContain("decision D3");
  expect(lines[3]).toContain("decision D2");
  expect(lines[4]).toContain("decision D4");
  expect(lines[5]).toContain("decision D1");
});

test("query keeps the first limit lines and says how many were left out", () => {
  const decisions = [1, 2, 3, 4, 5].map((i) => decision(`D${i}`, T0 + i, ["/r/a.ts"]));
  const lines = queryText(["/r/a.ts"], [], decisions, 3).split("\n");
  expect(lines.length).toBe(4);
  expect(lines[0]).toContain("D5");
  expect(lines[3]).toBe("2 more; narrow the paths or pass a larger limit");
  expect(queryText(["/r/zzz.ts"], [], decisions, 3)).toBe("No claims or decisions on these paths.");
});

test("decide appends to the repo's log with the author and the next id", async () => {
  const store = memStore();
  const a = await addDecision(store, "/r", { text: "keep the parser", paths: ["/r/p.ts"], author: "Ada" }, 200, T0);
  const b = await addDecision(store, "/r", { text: "  second  ", paths: ["/r/q.ts"], author: "main" }, 200, T0 + 1);
  expect(a.id).toBe("D1");
  expect(b.id).toBe("D2");
  expect(b.text).toBe("second");
  expect((await readRepo(store, "/r")).decisions.map((d) => d.author)).toEqual(["Ada", "main"]);
  expect(await readRepo(store, "/other")).toEqual({ decisions: [], archive_count: 0, contracts: [] });
});

test("a decision text is one non-empty line of at most 200 characters", () => {
  expect(decisionTextError("a\nb")).not.toBeNull();
  expect(decisionTextError("   ")).not.toBeNull();
  expect(decisionTextError("x".repeat(201))).not.toBeNull();
  expect(decisionTextError("x".repeat(200))).toBeNull();
});

test("past the cap the oldest decisions move to the archive and archive_count grows", async () => {
  const store = memStore();
  for (let i = 1; i <= 4; i++) await addDecision(store, "/r", { text: `d${i}`, paths: ["/r/x.ts"], author: "main" }, 2, T0 + i);
  const repo = await readRepo(store, "/r");
  expect(repo.decisions.map((d) => d.text)).toEqual(["d3", "d4"]);
  expect(repo.archive_count).toBe(2);
  const archive = store.data.get(ARCHIVE_KEY) as { decisions: Array<{ text: string; root: string }> };
  expect(archive.decisions.map((d) => d.text)).toEqual(["d1", "d2"]);
  expect(archive.decisions[0].root).toBe("/r");
  expect(queryText(["/r/x.ts"], [], repo.decisions, 40)).not.toContain("d1");
});

test("the conflict list and the repo state share the board value", async () => {
  const store = memStore();
  const conflict: Conflict = { ts: T0, path: "/r/a.ts", holder: "Ada", holder_id: "h", writer: "Bo", writer_id: "w", mode: "warn" };
  await appendConflicts(store, [conflict]);
  await addDecision(store, "/r", { text: "t", paths: ["/r/a.ts"], author: "main" }, 200, T0);
  expect((await readConflicts(store)).length).toBe(1);
  expect((await readRepo(store, "/r")).decisions.length).toBe(1);
});

const rows = [row("a", 0, "Ada"), row("b", 1, "Bo"), row("c", 2, "Cy"), row("d", 0, "Di")];

function summaryInput(over: Partial<SummaryInput> = {}): SummaryInput {
  return { rows, files: new Map([["b", ["/r/x.ts"]]]), scopeIds: null, conflicts: [], decisions: [], decisionsOn: true, runs: [], since: 0, ...over };
}

test("scopeRows gives a row and its subtree, or every row for main", () => {
  expect(scopeRows(rows, "b").map((r) => r.id)).toEqual(["b", "c"]);
  expect(scopeRows(rows, null).length).toBe(4);
  expect(scopeRows(rows, "nobody")).toEqual([]);
});

test("summary for a subtree lists its agents and the conflicts it touches since the last summary", () => {
  const conflicts: Conflict[] = [
    { ts: T0 + 1, path: "/r/x.ts", holder: "Di", holder_id: "d", writer: "Cy", writer_id: "c", mode: "warn" },
    { ts: T0 + 2, path: "/r/y.ts", holder: "Ada", holder_id: "a", writer: "Di", writer_id: "d", mode: "warn" },
    { ts: T0 - 5, path: "/r/old.ts", holder: "Di", holder_id: "d", writer: "Cy", writer_id: "c", mode: "warn" },
  ];
  const text = summaryText(summaryInput({ rows: scopeRows(rows, "b"), scopeIds: new Set(["b", "c"]), conflicts, since: T0 }));
  expect(text).toContain("Bo (working)");
  expect(text).not.toContain("Ada (working)");
  expect(text).toContain("conflict /r/x.ts: Cy wrote, Di holds");
  expect(text).not.toContain("/r/y.ts");
  expect(text).not.toContain("/r/old.ts");
});

test("summary for main lists every agent, and only decisions newer than the last summary", () => {
  const decisions = [decision("D1", T0 - 1, ["/r/a.ts"], "old"), decision("D2", T0 + 3, ["/r/a.ts"], "new", "Ada")];
  const text = summaryText(summaryInput({ decisions, since: T0 }));
  expect(text).toContain("Ada (working)");
  expect(text).toContain("Di (working)");
  expect(text).toContain("decision D2 Ada: new");
  expect(text).not.toContain("decision D1");
});

test("summary leaves the decision section out when decisions are off", () => {
  const decisions = [decision("D2", T0 + 3, ["/r/a.ts"], "new")];
  const text = summaryText(summaryInput({ decisions, decisionsOn: false, since: T0 }));
  expect(text).not.toContain("Decisions since");
  expect(text).not.toContain("new");
});

test("summary names unattributed changes on recent runs and stays within 30 lines", () => {
  const runs: RunLike[] = [{ name: "Ada", unattributed: ["/r/gen.ts"] }, { name: "Bo" }];
  expect(summaryText(summaryInput({ runs }))).toContain("unattributed Ada: /r/gen.ts");
  const many = Array.from({ length: 40 }, (_, i) => row(`w${i}`, 0, `Agent${i}`));
  expect(summaryText(summaryInput({ rows: many, files: new Map() })).split("\n").length).toBeLessThanOrEqual(30);
});

test("status is the caller's own row and its files, or a line saying it has none", () => {
  const text = statusText(row("a", 0, "Ada"), ["/r/x.ts"]);
  expect(text).toContain("Ada: working");
  expect(text).toContain('task "Ada task"');
  expect(text).toContain("files /r/x.ts");
  expect(statusText(undefined, [])).toBe("No crew row for this agent yet.");
});

test("a folder query reaches the claims and decisions beneath it", () => {
  const lines = queryText(["/r/a/"], [claim("/r/a/b.ts", "Bo", T0)], [decision("D1", T0 + 1, ["/r/a/c.ts"]), decision("D2", T0 + 2, ["/r/z.ts"])], 40).split("\n");
  expect(lines.length).toBe(2);
  expect(lines[0]).toContain("claim /r/a/b.ts held by Bo");
  expect(lines[1]).toContain("decision D1");
});

test("the query limit is a whole number from 1 to 400, 40 by default", () => {
  expect(limitOf(undefined)).toBe(40);
  expect(limitOf("abc")).toBe(40);
  expect(limitOf(7.9)).toBe(7);
  expect(limitOf(0)).toBe(1);
  expect(limitOf(9999)).toBe(400);
});

test("a claim whose holder stopped inside the grace window is still on the board, and drops after it", () => {
  let now = T0;
  const book = newBook(() => now);
  const settings = { claims: "warn" as const, claim_grace_min: 30 };
  claimSpawn(book, settings, { id: "a", name: "Ada", task: "", parentId: null, root: "/r", base: "/r", owns: "x.ts" });
  now = T0 + 5 * 60_000;
  stopAgent(book, "a");
  now = T0 + 10 * 60_000;
  expect(liveClaims(book, "/r", settings).map((c) => c.path)).toEqual(["/r/x.ts"]);
  now = T0 + 5 * 60_000 + 31 * 60_000;
  expect(liveClaims(book, "/r", settings).length).toBe(0);
});

/** The `board` handler as the registry hands it to the host: captured from registerAgentTools. */
function boardHandler(): (api: unknown, e: Record<string, unknown>) => Promise<{ result?: string; deny?: string }> {
  const handlers = new Map<string, (api: unknown, e: Record<string, unknown>) => Promise<{ result?: string; deny?: string }>>();
  registerAgentTools((event: unknown, filter: unknown, fn: never) => {
    if (event === "tool.call") handlers.set((filter as { tool: string }).tool, fn);
  }, "haikrew");
  return handlers.get("mcp__haikrew__board") as never;
}

/** A mod API whose git answers for folders under /r only, as a repo rooted at /r. */
function gitApi() {
  const store = memStore();
  const run = async (_argv: string[], init: { cwd?: string }) => (init.cwd ?? "").startsWith("/r")
    ? { exitCode: 0, stdout: "/r\n" }
    : { exitCode: 128, stdout: "" };
  return { store, process: { run }, session: { cwd: async () => "/r" }, ui: { toast() {}, invalidate() {} } };
}

test("the registered board tool decides then queries, with agent control off", async () => {
  const board = boardHandler();
  const $ = gitApi();
  expect(allowed(settingsFrom(undefined), "board")).toBeNull();
  const ok = await board($, { tool: "mcp__haikrew__board", action: "decide", text: "keep the parser in sync", paths: ["/r/p.ts"] });
  expect(ok.result).toBe("Recorded D1.");
  const out = await board($, { action: "query", paths: ["/r/p.ts"] });
  expect(out.result).toContain("keep the parser in sync");
});

test("the board tool finds the repo of a path whose folder does not exist yet, and names paths in no repo", async () => {
  const board = boardHandler();
  const $ = gitApi();
  const made = await board($, { action: "decide", text: "new folder", paths: ["/r/new/dir/x.ts"] });
  expect(made.result).toBe("Recorded D1.");
  const out = await board($, { action: "query", paths: ["/r/new/dir/x.ts", "/elsewhere/y.ts"] });
  expect(out.result).toContain("decision D1");
  expect(out.result).toContain("skipped /elsewhere/y.ts");
  const split = await board($, { action: "decide", text: "two repos", paths: ["/r/a.ts", "/elsewhere/b.ts"] });
  expect(split.deny).toContain("No git repo holds");
});
