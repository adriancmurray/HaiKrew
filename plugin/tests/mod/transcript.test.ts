/** Stop handling past the read limit: the digest fallback, partial rows, and record_verdict under the ledger lock. */
import { expect, test } from "claude-code/testing";
import { reviewTool } from "../../src/mod/agents.ts";
import { addRun, digestScan, emptyScan, parseDigest, readState, runFromDigest, scanEntry } from "../../src/mod/ledger.ts";
import { ledgerLock } from "../../src/mod/serial.ts";
import { readTranscript } from "../../src/mod/transcript.ts";
import { defaults } from "../../src/schema.ts";

const LINE = JSON.stringify({
  type: "assistant",
  timestamp: "2026-10-30T10:00:00.000Z",
  message: { id: "m1", model: "claude-haiku-5-5", usage: { input_tokens: 7, output_tokens: 1 }, content: [{ type: "text", text: "Done.\nSTATUS: done" }] },
});

const digestLine = (): string => {
  const scan = emptyScan();
  scanEntry(scan, JSON.parse(LINE), 0);
  return JSON.stringify(digestScan(scan));
};

const fail = async (): Promise<string> => {
  throw new Error("over 4 MiB");
};

test("readTranscript parses what the mod can read and never starts the CLI", async () => {
  let started = 0;
  const read = await readTranscript({ read: async () => LINE, digest: async () => { started++; return ""; } }, "/t.jsonl");
  expect(read?.report).toBe("Done.\nSTATUS: done");
  expect(read?.tokens_in).toBe(7);
  expect(started).toBe(0);
});

test("readTranscript falls back to the digest when the read rejects", async () => {
  const read = await readTranscript({ read: fail, digest: async () => digestLine() }, "/t.jsonl");
  expect(read?.report).toBe("Done.\nSTATUS: done");
  expect(read?.model).toBe("claude-haiku-5-5");
});

test("readTranscript gives up when the CLI fails or prints something else", async () => {
  expect(await readTranscript({ read: fail, digest: fail }, "/t.jsonl")).toBeNull();
  expect(await readTranscript({ read: fail, digest: async () => "usage: haikrew" }, "/t.jsonl")).toBeNull();
});

test("parseDigest refuses JSON that is not a digest", () => {
  expect(parseDigest("[]")).toBeNull();
  expect(parseDigest('{"model":"m"}')).toBeNull();
});

test("a run from a digest does not carry the report into the ledger row", () => {
  const digest = parseDigest(digestLine());
  if (!digest) throw new Error("no digest");
  const run = runFromDigest({ agent_id: "a1", agent_type: "haiku-coder", session_id: "s" }, digest);
  expect(run.agent_id).toBe("a1");
  expect(run.tokens_in).toBe(7);
  expect("report" in run).toBe(false);
  expect("prompt" in run).toBe(false);
});

const row = (agent: string, name: string) => ({
  ts: "2026-10-30T10:00:00Z", session: "s", agent_id: agent, agent_type: "haiku-coder", model: "haiku", job: "code", lang: "ts",
  duration_s: 1, tokens_in: 1, tokens_out: 1, cache_read: 0, cache_write: 0, tokens_estimated: true, tool_calls: 0, attempts: 1,
  quality: 0, name,
});

test("a partial stop keeps the row the agent already has, and a full stop replaces a partial row", () => {
  const settings = defaults() as never;
  const complete = { ...row("a1", "Ada"), ts: "2026-10-30T10:00:00Z", tokens_in: 50_000, verdict: "pass" };
  const state = addRun({ runs: [], buckets: [] }, complete as never, settings);
  const partial = { ...row("a1", "Ada"), ts: "2026-10-30T11:00:00Z", tokens_in: 0, lang: "unknown", partial: true };
  const kept = addRun(state, partial as never, settings);
  expect(kept.runs[0]?.tokens_in).toBe(50_000);
  expect(kept.runs[0]?.verdict).toBe("pass");
  expect("partial" in (kept.runs[0] as object)).toBe(false);

  const first = addRun({ runs: [], buckets: [] }, partial as never, settings);
  expect(first.runs[0]?.partial).toBe(true);
  const full = addRun(first, { ...row("a1", "Ada"), ts: "2026-10-30T12:00:00Z", tokens_in: 7 } as never, settings);
  expect(full.runs[0]?.tokens_in).toBe(7);
  expect("partial" in (full.runs[0] as object)).toBe(false);
});

test("record_verdict and a stop recording at once both keep their writes", async () => {
  let stored: unknown = { runs: [row("a1", "Ada")], buckets: [] };
  const tick = () => new Promise((done) => setTimeout(done, 1));
  const $: any = {
    store: {
      get: async () => { await tick(); return stored; },
      set: async (_key: string, value: unknown) => { await tick(); stored = value; },
    },
    ui: { toast: () => {}, invalidate: () => {} },
  };
  const verdict = reviewTool("record_verdict", { agent: "Ada", verdict: "pass" }, $);
  const stop = ledgerLock(async () => {
    const state = readState(await $.store.get("ledger"));
    await $.store.set("ledger", { ...state, runs: [...state.runs, row("a2", "Bob")] });
  });
  await Promise.all([verdict, stop]);
  const { runs } = readState(stored);
  expect(runs.map((r) => r.agent_id)).toEqual(["a1", "a2"]);
  expect(runs[0]?.verdict).toBe("pass");
});
