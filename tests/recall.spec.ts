/** Recall: extraction, chunking, vectors, resumable indexing, ranking, shards, the lock, the mod tool and the loopback rule. */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { CHUNK_MAX, DOC_PREFIX, cosine, decodeVector, encodeVector, entriesOf, exactBonus, isLoopbackUrl, linesOf, parseStored, queryWords, splitText } from "../plugin/src/recall.ts";
import { BATCH, evict, indexProjects, prune, reset } from "../plugin/src/recall-index.ts";
import type { Offset, RecallIo } from "../plugin/src/recall-index.ts";
import { formatHits, manifestOf, searchStore } from "../plugin/src/recall-search.ts";
import type { RecallFs, RecallHttp } from "../plugin/src/recall-search.ts";
import { nodeFs, storeIo, takeLock } from "../plugin/src/recall-store.ts";
import { folderOf } from "../plugin/src/recallcli.ts";
import { recallTool } from "../plugin/src/mod/recall-tool.ts";
import { validate } from "../plugin/src/schema.ts";
import type { Settings } from "../plugin/src/schema.ts";

const T = "2026-10-13T10:00:00.000Z";

/** A transcript line of the given type with message content, as Claude Code writes it. */
const line = (type: string, session: string, time: string, content: unknown, extra: Record<string, unknown> = {}): string =>
  `${JSON.stringify({ type, sessionId: session, timestamp: time, message: { role: type, content }, ...extra })}\n`;
const user = (session: string, time: string, text: string): string => line("user", session, time, text);
const asst = (session: string, time: string, text: string): string => line("assistant", session, time, [{ type: "text", text }]);

type Embed = (texts: string[]) => Promise<number[][]>;

/** An embedder that returns a fixed vector for each stored text, and [1,0,0] for every query. */
const fixedVectors = (vectors: Record<string, number[]>): Embed => async (texts) =>
  texts.map((t) => (t.startsWith("task:") ? [1, 0, 0] : vectors[t.slice(DOC_PREFIX.length)] ?? [0, 0, 1]));

/** Any embedder: a small vector per text, enough for counting and resuming. */
const anyVector: Embed = async (texts) => texts.map((t) => [1, t.length % 5 + 1, 0, 0]);

/**
 * An in-memory RecallIo over transcripts (project -> file name -> text). `index` and `offsets` show what was stored.
 * The text of a file may be changed between runs to model a session that keeps going.
 */
function memoryIo(transcripts: Record<string, Record<string, string>>, embed: Embed = anyVector) {
  const index = new Map<string, string>();
  const offsets = new Map<string, Record<string, Offset>>();
  const sent: string[] = [];
  const io: RecallIo = {
    projects: () => Object.keys(transcripts),
    transcripts: (p) => Object.keys(transcripts[p] ?? {}),
    readFrom: (p, name, from) => Buffer.from(transcripts[p][name]).subarray(from),
    indexed: () => [...index.keys()],
    readIndex: (p) => index.get(p) ?? "",
    size: (p) => Buffer.byteLength(index.get(p) ?? ""),
    appendIndex: (p, text) => index.set(p, (index.get(p) ?? "") + text),
    writeIndex: (p, text) => index.set(p, text),
    readOffsets: (p) => (index.has(p) ? { ...(offsets.get(p) ?? {}) } : {}),
    writeOffsets: (p, o) => {
      if (!index.has(p)) index.set(p, "");
      offsets.set(p, { ...o });
    },
    removeIndex: (p) => {
      index.delete(p);
      offsets.delete(p);
    },
    embed: async (texts) => {
      sent.push(...texts);
      return embed(texts);
    },
    now: () => Date.parse(T),
  };
  return { io, index, offsets, sent };
}

/** A stored line as the index writes it, for the tool and shard tests. */
const row = (project: string, session: string, lineNo: number, time: string, role: string, text: string, vec = [1, 0, 0]): string =>
  `${JSON.stringify({ project, session, line: lineNo, time, role, text, vec: encodeVector(vec) })}\n`;

test("entriesOf keeps the person's text, assistant text and hand-back reports", () => {
  assert.deepEqual(entriesOf(user("s1", T, "why did we hold contracts?")).map((e) => [e.role, e.text]),
    [["person", "why did we hold contracts?"]]);
  assert.deepEqual(entriesOf(asst("s1", T, "Held: contracts wait.")).map((e) => [e.role, e.text]),
    [["assistant", "Held: contracts wait."]]);
  const handback = line("assistant", "s1", T, [{ type: "tool_use", name: "SubagentHandback", input: { message: "Done: 3 files." } }]);
  assert.deepEqual(entriesOf(handback).map((e) => [e.role, e.text]), [["handback", "Done: 3 files."]]);
  const wrongKey = line("assistant", "s1", T, [{ type: "tool_use", name: "SubagentHandback", input: { text: "not read" } }]);
  assert.deepEqual(entriesOf(wrongKey), []);
  assert.equal(entriesOf(user("s1", T, "x"))[0].session, "s1");
});

test("entriesOf drops tool output, tool calls, harness notices and unparseable lines", () => {
  assert.deepEqual(entriesOf(line("user", "s1", T, [{ type: "tool_result", content: "grep output" }])), []);
  assert.deepEqual(entriesOf(line("assistant", "s1", T, [{ type: "tool_use", name: "Bash", input: { command: "ls" } }])), []);
  assert.deepEqual(entriesOf(user("s1", T, "<task-notification>done</task-notification>")), []);
  assert.deepEqual(entriesOf(user("s1", T, "<local-command-stdout>ok</local-command-stdout>")), []);
  assert.deepEqual(entriesOf(user("s1", T, "Another Claude session sent a message: hi")), []);
  assert.deepEqual(entriesOf(user("s1", T, "HaiKrew review: pass")), []);
  assert.deepEqual(entriesOf(user("s1", T, "This session is being continued from a previous conversation.")), []);
  assert.deepEqual(entriesOf(user("s1", T, "[Request interrupted by user]")), []);
  assert.deepEqual(entriesOf(line("user", "s1", T, "meta", { isMeta: true })), []);
  assert.deepEqual(entriesOf(line("user", "s1", T, "summary text", { isCompactSummary: true })), []);
  assert.deepEqual(entriesOf(line("system", "s1", T, "notice")), []);
  assert.deepEqual(entriesOf("{not json"), []);
});

test("entriesOf strips system reminders from a mixed user message and keeps the rest", () => {
  const mixed = line("user", "s1", T, [
    { type: "text", text: "<system-reminder>\nWorktree path: /x\n</system-reminder>\n\n" },
    { type: "text", text: "real words here" },
  ]);
  assert.deepEqual(entriesOf(mixed).map((e) => e.text), ["real words here"]);
});

test("splitText keeps short text whole and cuts long text at paragraph breaks", () => {
  assert.deepEqual(splitText("short"), ["short"]);
  const para = (c: string): string => c.repeat(600);
  const text = [para("a"), para("b"), para("c")].join("\n\n");
  const parts = splitText(text);
  assert.equal(parts.length, 2);
  assert.ok(parts.every((p) => p.length <= CHUNK_MAX));
  assert.equal(parts.join("\n\n"), text);
  assert.deepEqual(splitText("x".repeat(3500)).map((p) => p.length), [1500, 1500, 500]);
});

test("vectors round-trip through base64 float32, and text that is not base64 floats is refused", () => {
  assert.deepEqual([...(decodeVector(encodeVector([0.5, -1.25, 3])) ?? [])], [0.5, -1.25, 3]);
  assert.deepEqual([...(decodeVector(encodeVector([0.1, 0.2])) ?? [])].map((x) => Math.round(x * 10) / 10), [0.1, 0.2]);
  assert.equal(decodeVector("not*base64"), null);
  assert.equal(decodeVector("AAA"), null);
  assert.equal(cosine(Float32Array.from([1, 0]), Float32Array.from([1, 0])), 1);
  assert.equal(cosine(Float32Array.from([1, 0]), Float32Array.from([0, 1])), 0);
  assert.equal(cosine(Float32Array.from([0, 0]), Float32Array.from([1, 0])), 0);
});

test("the exact-word bonus counts whole words, ignores case and stop words", () => {
  assert.deepEqual(queryWords("what did outcome() return?"), ["outcome", "return"]);
  assert.equal(exactBonus(["outcome"], "Outcome() returns verdicts"), 0.1);
  assert.equal(exactBonus(["outcome"], "returns outcomes"), 0);
});

test("a stored line that is cut short or mistyped is not a chunk", () => {
  const good = row("p", "s", 1, T, "person", "whole");
  assert.equal(parseStored(good.slice(0, -20)), null);
  assert.equal(parseStored(good.replace('"line":1', '"line":"1"')), null);
  assert.equal(parseStored(good.replace('"role":"person"', '"role":"robot"')), null);
  assert.equal(parseStored(good)?.text, "whole");
});

test("search ranks by cosine and lets the exact word lift a close second", async () => {
  const x = "outcome() returns verdicts";
  const y = "the result returns verdicts";
  const m = memoryIo({ p: { "s.jsonl": user("s", T, x) + user("s", T, y) } },
    fixedVectors({ [x]: [0.6, 0.8, 0], [y]: [0.68, Math.sqrt(1 - 0.68 * 0.68), 0] }));
  await indexProjects(m.io, ["p"], 1e9);
  const env = storeEnv(m.index, "p");
  const res = await searchStore(env, "outcome()", { n: 2 });
  assert.deepEqual(res.hits.map((h) => h.text), [x, y]);
  assert.match(formatHits(res.hits), /^2026-10-13 person s:1\n {2}outcome\(\) returns verdicts\n/);
});

/** A search environment over the memory index: the index text is served as one shard of `project`. */
function storeEnv(index: Map<string, string>, project: string): { root: string; url: string; model: string; fs: RecallFs; http: RecallHttp } {
  const files: Record<string, string> = { [`/r/${project}/manifest.json`]: JSON.stringify({ shards: ["0001.jsonl"] }),
    [`/r/${project}/0001.jsonl`]: index.get(project) ?? "" };
  return { root: "/r", url: "http://127.0.0.1:11434", model: "embeddinggemma", fs: fakeFs(files), http: queryHttp([1, 0, 0]) };
}

/** Files by absolute path. A missing path rejects, as $.fs.read does. */
function fakeFs(files: Record<string, string>): RecallFs {
  return {
    read: async (p) => {
      if (p in files) return files[p];
      throw new Error(`ENOENT ${p}`);
    },
    list: async (dir) => {
      const prefix = `${dir}/`;
      const names = Object.keys(files).filter((f) => f.startsWith(prefix)).map((f) => f.slice(prefix.length).split("/")[0]);
      if (names.length === 0) throw new Error(`ENOENT ${dir}`);
      return [...new Set(names)];
    },
  };
}

/** An HTTP fake that answers every embed call with one vector. */
function queryHttp(vector: number[], ok = true): RecallHttp {
  return { post: async () => ({ ok, status: ok ? 200 : 500, text: JSON.stringify({ embeddings: [vector] }) }) };
}

const SETTINGS = { recall: { enabled: true, model: "embeddinggemma", url: "http://127.0.0.1:11434", max_mb: 200 } } as unknown as Settings;

test("the recall tool searches the shards through the adapters and counts a truncated line", async () => {
  const files = {
    "/r/p1/manifest.json": JSON.stringify({ shards: ["0001.jsonl"] }),
    "/r/p1/0001.jsonl": row("p1", "s1", 4, T, "person", "we held the contracts", [1, 0, 0]) +
      row("p1", "s1", 5, T, "assistant", "unrelated", [0, 1, 0]) + '{"project":"p1","sess',
  };
  const reply = await recallTool({ question: "contracts" }, SETTINGS, { root: "/r", fs: fakeFs(files), http: queryHttp([1, 0, 0]) });
  assert.ok("result" in reply);
  assert.match(reply.result, /^2026-10-13 person s1:4\n {2}we held the contracts/);
  assert.match(reply.result, /\(1 unreadable line\(s\) or shard\(s\) skipped\)$/);
});

test("the recall tool refuses when recall is off, the address is not loopback, or the question is empty", async () => {
  const env = { root: "/r", fs: fakeFs({}), http: queryHttp([1, 0, 0]) };
  const off = { recall: { ...SETTINGS.recall, enabled: false } } as unknown as Settings;
  assert.match((await recallTool({ question: "x" }, off, env) as { deny: string }).deny, /Recall is off/);
  const remote = { recall: { ...SETTINGS.recall, url: "http://203.0.113.9:11434" } } as unknown as Settings;
  assert.match((await recallTool({ question: "x" }, remote, env) as { deny: string }).deny, /loopback/);
  assert.match((await recallTool({ question: "  " }, SETTINGS, env) as { deny: string }).deny, /Give the question/);
  assert.match((await recallTool({ question: "x", project: "../etc" }, SETTINGS, env) as { deny: string }).deny, /folder name/);
});

test("the recall tool says so when the store is empty and when the embedding call fails", async () => {
  const empty = await recallTool({ question: "x" }, SETTINGS, { root: "/r", fs: fakeFs({}), http: queryHttp([1, 0, 0]) });
  assert.deepEqual(empty, { result: "recall: no hits" });
  const failed = await recallTool({ question: "x" }, SETTINGS, { root: "/r", fs: fakeFs({}), http: queryHttp([1, 0, 0], false) });
  assert.deepEqual(failed, { deny: "Recall failed: embed: HTTP 500" });
});

test("the settings schema and the runtime both refuse a non-loopback Ollama address", () => {
  assert.equal(validate("recall", "url", "http://127.0.0.1:11434"), null);
  assert.equal(validate("recall", "url", "http://localhost:11434"), null);
  assert.equal(validate("recall", "url", "http://[::1]:11434"), null);
  assert.notEqual(validate("recall", "url", "http://192.168.1.5:11434"), null);
  assert.notEqual(validate("recall", "url", "https://ollama.example.com"), null);
  assert.equal(isLoopbackUrl("http://127.0.0.1.evil.example:11434"), false);
  assert.equal(isLoopbackUrl("http://127.0.0.1:11434"), true);
});

test("a second run reads only the new lines and numbers them on from the last", async () => {
  const files = { p: { "s1.jsonl": user("s1", T, "first question") + asst("s1", T, "first answer") } };
  const m = memoryIo(files);
  assert.equal((await indexProjects(m.io, ["p"], 1e9)).chunks, 2);
  files.p["s1.jsonl"] += user("s1", T, "second question") + '{"type":"user"';
  const before = m.sent.length;
  assert.equal((await indexProjects(m.io, ["p"], 1e9)).chunks, 1);
  assert.deepEqual(m.sent.slice(before).map((t) => t.slice(DOC_PREFIX.length)), ["second question"]);
  assert.deepEqual(linesOf(m.index.get("p") ?? "").map((l) => [JSON.parse(l).line, JSON.parse(l).text]),
    [[1, "first question"], [2, "first answer"], [3, "second question"]]);
});

test("prune drops chunks older than the cutoff, and reset deletes a project's index and offsets", async () => {
  const m = memoryIo({ p: { "old.jsonl": user("old", "2026-01-01T00:00:00Z", "old words"), "new.jsonl": user("new", "2026-10-12T00:00:00Z", "new words") } });
  await indexProjects(m.io, ["p"], 1e9);
  assert.equal(prune(m.io, Date.parse("2026-06-01T00:00:00Z")), 1);
  assert.deepEqual(linesOf(m.index.get("p") ?? "").map((l) => JSON.parse(l).session), ["new"]);
  assert.equal(reset(m.io, "p"), 1);
  assert.equal(m.index.has("p"), false);
  assert.equal(m.offsets.has("p"), false);
});

test("over the size cap the oldest session goes first, and its offset keeps it from being indexed again", async () => {
  const m = memoryIo({ p: {
    "a.jsonl": user("a", "2026-01-01T00:00:00Z", "x".repeat(200)),
    "b.jsonl": user("b", "2026-02-01T00:00:00Z", "y".repeat(200)),
    "c.jsonl": user("c", "2026-03-01T00:00:00Z", "z".repeat(200)),
  } });
  await indexProjects(m.io, ["p"], 1e9);
  const total = m.io.size("p");
  assert.equal(evict(m.io, total - 1), 1);
  assert.deepEqual([...new Set(linesOf(m.index.get("p") ?? "").map((l) => JSON.parse(l).session))], ["b", "c"]);
  assert.equal((await indexProjects(m.io, ["p"], total - 1)).chunks, 0);
});

test("an embed failure stores nothing for its batch, does not throw, and the next run stores the rest once", async () => {
  const text = Array.from({ length: BATCH + 8 }, (_, i) => user("s", T, `message ${i}`)).join("");
  let calls = 0;
  const flaky: Embed = async (texts) => {
    calls++;
    if (calls === 2) throw new Error("timeout");
    return texts.map(() => [1, 0, 0, 0]);
  };
  const m = memoryIo({ p: { "s.jsonl": text } }, flaky);
  assert.deepEqual(await indexProjects(m.io, ["p"], 1e9), { chunks: BATCH, failures: 1 });
  assert.deepEqual(await indexProjects(m.io, ["p"], 1e9), { chunks: 8, failures: 0 });
  assert.deepEqual(linesOf(m.index.get("p") ?? "").map((l) => JSON.parse(l).line), Array.from({ length: BATCH + 8 }, (_, i) => i + 1));
});

test("the index splits into shards under the size cap, and the search reads them back in order", async () => {
  const dir = mkdtempSync(join(tmpdir(), "recall-shards-"));
  try {
    const projects = join(dir, "projects");
    mkdirSync(join(projects, "p"), { recursive: true });
    const text = Array.from({ length: 12 }, (_, i) => user("s", T, `message number ${i} ${"w".repeat(120)}`)).join("");
    writeFileSync(join(projects, "p", "s.jsonl"), text);
    const root = join(dir, "store");
    const io = storeIo({ root, projectsDir: projects, embed: anyVector, shardMax: 700 });
    assert.equal((await indexProjects(io, ["p"], 1e9)).chunks, 12);
    const shards = manifestOf(readFileSync(join(root, "p", "manifest.json"), "utf8"));
    assert.ok(shards.length > 1, "more than one shard");
    for (const s of shards) assert.ok(readFileSync(join(root, "p", s), "utf8").length <= 700 + 200, `${s} stays near the cap`);
    const res = await searchStore({ root, url: "http://127.0.0.1:11434", model: "m", fs: nodeFs(), http: queryHttp([1, 0, 0]) },
      "message", { n: 12 });
    assert.equal(res.hits.length, 12);
    assert.equal(res.skipped, 0);
    assert.equal(folderOf("/a/b.c"), "-a-b-c");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the store lock is held by a live process, and a dead one's lock is taken over", () => {
  const dir = mkdtempSync(join(tmpdir(), "recall-lock-"));
  try {
    const release = takeLock(dir);
    assert.ok(release);
    assert.equal(takeLock(dir), null, "a live holder keeps the lock");
    release();
    const again = takeLock(dir);
    assert.ok(again);
    again();
    writeFileSync(join(dir, ".lock"), `4194303 ${Date.now()}`);
    const taken = takeLock(dir);
    assert.ok(taken, "a lock whose process is gone is taken over");
    taken();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
