/** Mod tests for file claims: declared and implicit claims, sibling conflicts in warn and deny, ancestors, grace, retries and the log. */
import { expect, test } from "claude-code/testing";
import { bashPaths, checkWrite, claimSpawn, logConflicts, newBook, normalise, stopAgent } from "../../src/mod/claims.ts";
import type { BoardSettings, Spawn, Store } from "../../src/mod/claims.ts";

const MINUTE = 60_000;
const WARN: BoardSettings = { claims: "warn", claim_grace_min: 30 };
const DENY: BoardSettings = { claims: "deny", claim_grace_min: 30 };
const ROOT = "/repo";
const ADVICE = "If you must change it, retry the same write and it will go through; the director is told.";

/** A fixed clock the test moves by hand. */
function clockBook() {
  let now = Date.parse("2026-10-13T09:00:00Z");
  const book = newBook(() => now);
  return { book, tick: (ms: number) => { now += ms; } };
}

/** A spawn in the repo root, under `parentId` when given. */
function spawn(id: string, name: string, owns = "", parentId: string | null = null): Spawn {
  return { id, name, task: `${name}'s task`, parentId, root: ROOT, base: ROOT, owns };
}

/** A writer's identity for checkWrite. */
const who = (id: string, name: string) => ({ id, name, task: `${name}'s task` });

/** An in-memory store with the mod store's get and set. */
function memStore(): Store & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return { data, get: async (k: string) => data.get(k), set: async (k: string, v: unknown) => { data.set(k, v); } };
}

test("normalise makes paths absolute, drops dots and keeps a directory's slash", () => {
  expect(normalise("plugin/./src/../src/a.ts", "/repo")).toBe("/repo/plugin/src/a.ts");
  expect(normalise("/repo//x/", "/elsewhere")).toBe("/repo/x/");
  expect(normalise("a.ts", "")).toBe("");
});

test("declared owns= claims files at spawn, and a sibling's first write to one is refused with a retry hint", () => {
  const { book } = clockBook();
  claimSpawn(book, WARN, spawn("A", "Ada", "src/a.ts"));
  claimSpawn(book, WARN, spawn("B", "Bea"));
  const out = checkWrite(book, WARN, who("B", "Bea"), ["/repo/src/a.ts"], ROOT);
  expect(out.deny).toBe(`/repo/src/a.ts is held by Ada (Ada's task). ${ADVICE}`);
  expect(out.notes).toEqual([]);
  expect(out.logged).toHaveLength(0);
});

test("an implicit claim comes from the first write to an unclaimed path, and the refused sibling is logged at its stop", () => {
  const { book } = clockBook();
  claimSpawn(book, WARN, spawn("A", "Ada"));
  claimSpawn(book, WARN, spawn("B", "Bea"));
  expect(checkWrite(book, WARN, who("A", "Ada"), ["/repo/new.ts"], ROOT).deny).toBeUndefined();
  expect(checkWrite(book, WARN, who("B", "Bea"), ["/repo/new.ts"], ROOT).deny).toContain("held by Ada");
  const closed = stopAgent(book, "B");
  expect(closed).toHaveLength(1);
  expect(closed[0]?.holder_id).toBe("A");
});

test("deny refuses every time with the holder and its task, and claims nothing", () => {
  const { book } = clockBook();
  checkWrite(book, DENY, who("A", "Ada"), ["/repo/x.ts"], ROOT);
  const out = checkWrite(book, DENY, who("B", "Bea"), ["/repo/y.ts", "/repo/x.ts"], ROOT);
  expect(out.deny).toBe("/repo/x.ts is held by Ada (Ada's task); coordinate with the director or leave it");
  expect(out.notes).toHaveLength(0);
  expect(checkWrite(book, DENY, who("B", "Bea"), ["/repo/x.ts"], ROOT).deny).toBeDefined();
  expect(checkWrite(book, DENY, who("C", "Cy"), ["/repo/y.ts"], ROOT).deny).toBeUndefined();
  expect(stopAgent(book, "B")[0]?.mode).toBe("deny");
});

test("warn refuses the first write, and a retry within the window goes through with the director told once", () => {
  const { book } = clockBook();
  checkWrite(book, WARN, who("A", "Ada"), ["/repo/x.ts"], ROOT);
  const refused = checkWrite(book, WARN, who("B", "Bea"), ["/repo/x.ts"], ROOT);
  const retry = checkWrite(book, WARN, who("B", "Bea"), ["/repo/x.ts"], ROOT);
  const again = checkWrite(book, WARN, who("B", "Bea"), ["/repo/x.ts"], ROOT);
  expect(refused.deny).toContain("held by Ada");
  expect(retry.deny).toBeUndefined();
  expect(retry.notes).toEqual(["/repo/x.ts is held by Ada (Ada's task); the write went through on retry"]);
  expect(retry.logged).toHaveLength(1);
  expect(retry.logged[0]?.mode).toBe("warn");
  expect(again.deny).toBeUndefined();
  expect(again.notes).toHaveLength(0);
  expect(again.logged).toHaveLength(0);
});

test("a retry after the 10-minute window is refused again", () => {
  const { book, tick } = clockBook();
  checkWrite(book, WARN, who("A", "Ada"), ["/repo/x.ts"], ROOT);
  expect(checkWrite(book, WARN, who("B", "Bea"), ["/repo/x.ts"], ROOT).deny).toBeDefined();
  tick(11 * MINUTE);
  expect(checkWrite(book, WARN, who("B", "Bea"), ["/repo/x.ts"], ROOT).deny).toBeDefined();
});

test("parent and child, at any depth, never clash", () => {
  const { book } = clockBook();
  claimSpawn(book, WARN, spawn("P", "Pat", "lead.ts"));
  claimSpawn(book, WARN, spawn("C", "Cy", "child.ts", "P"));
  claimSpawn(book, WARN, spawn("G", "Gus", "grand.ts", "C"));
  expect(checkWrite(book, WARN, who("C", "Cy"), ["/repo/lead.ts"], ROOT).deny).toBeUndefined();
  expect(checkWrite(book, WARN, who("P", "Pat"), ["/repo/child.ts", "/repo/grand.ts"], ROOT).deny).toBeUndefined();
  expect(checkWrite(book, WARN, who("G", "Gus"), ["/repo/lead.ts"], ROOT).deny).toBeUndefined();
  expect(stopAgent(book, "C")).toHaveLength(0);
});

test("the main thread never claims and never clashes", () => {
  const { book } = clockBook();
  const main = checkWrite(book, DENY, who("", ""), ["/repo/m.ts"], ROOT);
  expect(main).toEqual({ notes: [], logged: [] });
  expect(checkWrite(book, DENY, who("A", "Ada"), ["/repo/m.ts"], ROOT).deny).toBeUndefined();
});

test("claims off makes no claims and no clashes", () => {
  const { book } = clockBook();
  const off: BoardSettings = { claims: "off", claim_grace_min: 30 };
  claimSpawn(book, off, spawn("A", "Ada", "x.ts"));
  checkWrite(book, off, who("A", "Ada"), ["/repo/z.ts"], ROOT);
  expect(checkWrite(book, WARN, who("B", "Bea"), ["/repo/x.ts", "/repo/z.ts"], ROOT).deny).toBeUndefined();
});

test("a directory claim covers the files under it, and not a sibling with a longer name", () => {
  const { book } = clockBook();
  claimSpawn(book, WARN, spawn("A", "Ada", "plugin/tests/"));
  claimSpawn(book, WARN, spawn("B", "Bea"));
  expect(checkWrite(book, WARN, who("B", "Bea"), ["/repo/plugin/tests/deep/x.ts"], ROOT).deny).toBeDefined();
  expect(checkWrite(book, WARN, who("B", "Bea"), ["/repo/plugin/tests2/x.ts"], ROOT).deny).toBeUndefined();
});

test("bash markers name no file, so they claim nothing; a plain redirect claims its target", () => {
  expect(bashPaths("git reset --hard")).toEqual([]);
  expect(bashPaths("git commit -m msg")).toEqual([]);
  expect(bashPaths("echo hi > /repo/a.ts")).toEqual(["/repo/a.ts"]);
});

test("a Bash target resolves through an absolute leading cd; a relative one claims nothing", () => {
  expect(bashPaths("cd /abs/dir && echo x > a.ts")).toEqual(["/abs/dir/a.ts"]);
  expect(bashPaths("cd sub && echo x > a.ts")).toEqual([]);
  expect(bashPaths("echo x > a.ts")).toEqual([]);
});

test("a read-only agent claims nothing, so the implementer's later write is not refused", () => {
  const { book } = clockBook();
  claimSpawn(book, WARN, spawn("R", "Rae"));
  claimSpawn(book, WARN, spawn("B", "Bea"));
  const reader = { ...who("R", "Rae"), readOnly: true };
  expect(checkWrite(book, WARN, reader, ["/repo/x.ts"], ROOT)).toEqual({ notes: [], logged: [] });
  expect(checkWrite(book, WARN, who("B", "Bea"), ["/repo/x.ts"], ROOT).deny).toBeUndefined();
});

test("a declared path a live claim already covers is left to its holder", () => {
  const { book } = clockBook();
  claimSpawn(book, WARN, spawn("A", "Ada", "x.ts"));
  claimSpawn(book, WARN, spawn("B", "Bea", "x.ts"));
  checkWrite(book, WARN, who("B", "Bea"), ["/repo/x.ts"], ROOT);
  expect(stopAgent(book, "B")[0]?.holder_id).toBe("A");
});

test("a finished holder's claim holds through the grace window, then expires", () => {
  const { book, tick } = clockBook();
  claimSpawn(book, WARN, spawn("A", "Ada", "g.ts"));
  claimSpawn(book, WARN, spawn("B", "Bea"));
  claimSpawn(book, WARN, spawn("C", "Cy"));
  stopAgent(book, "A");
  tick(29 * MINUTE);
  expect(checkWrite(book, WARN, who("B", "Bea"), ["/repo/g.ts"], ROOT).deny).toBeDefined();
  tick(2 * MINUTE);
  expect(checkWrite(book, WARN, who("B", "Bea"), ["/repo/g.ts"], ROOT).deny).toBeUndefined();
  expect(checkWrite(book, WARN, who("C", "Cy"), ["/repo/g.ts"], ROOT).deny).toContain("held by Bea");
});

test("a resumed holder keeps its claim: its writes clear the end time", () => {
  const { book, tick } = clockBook();
  claimSpawn(book, WARN, spawn("A", "Ada", "r.ts"));
  claimSpawn(book, WARN, spawn("B", "Bea"));
  stopAgent(book, "A");
  tick(10 * MINUTE);
  checkWrite(book, WARN, who("A", "Ada"), ["/repo/r.ts"], ROOT);
  tick(60 * MINUTE);
  expect(checkWrite(book, WARN, who("B", "Bea"), ["/repo/r.ts"], ROOT).deny).toBeDefined();
});

test("a conflict the writer never retries is logged backed off at its stop", async () => {
  const { book } = clockBook();
  const store = memStore();
  claimSpawn(book, WARN, spawn("A", "Ada", "x.ts"));
  claimSpawn(book, WARN, spawn("B", "Bea"));
  checkWrite(book, WARN, who("B", "Bea"), ["/repo/x.ts"], ROOT);
  await logConflicts(store, stopAgent(book, "B"));
  const logged = (store.data.get("board") as { conflicts: { backed_off?: boolean; writer: string }[] }).conflicts;
  expect(logged).toHaveLength(1);
  expect(logged[0]?.writer).toBe("Bea");
  expect(logged[0]?.backed_off).toBe(true);
});

test("a conflict the writer retries is logged not backed off, once", async () => {
  const { book } = clockBook();
  const store = memStore();
  claimSpawn(book, WARN, spawn("A", "Ada", "x.ts"));
  claimSpawn(book, WARN, spawn("B", "Bea"));
  checkWrite(book, WARN, who("B", "Bea"), ["/repo/x.ts"], ROOT);
  await logConflicts(store, checkWrite(book, WARN, who("B", "Bea"), ["/repo/x.ts"], ROOT).logged);
  await logConflicts(store, stopAgent(book, "B"));
  const logged = (store.data.get("board") as { conflicts: { backed_off?: boolean }[] }).conflicts;
  expect(logged).toHaveLength(1);
  expect(logged[0]?.backed_off).toBe(false);
});

test("the conflict log keeps the newest 200 entries", async () => {
  const store = memStore();
  const entry = (n: number) => ({ ts: n, path: "/repo/x.ts", holder: "Ada", writer: "Bea", holder_id: "A", writer_id: "B", mode: "warn" as const });
  await logConflicts(store, Array.from({ length: 205 }, (_, i) => entry(i)));
  const logged = (store.data.get("board") as { conflicts: { ts: number }[] }).conflicts;
  expect(logged).toHaveLength(200);
  expect(logged[0]?.ts).toBe(5);
});
