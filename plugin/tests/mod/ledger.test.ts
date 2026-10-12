/** Mod tests for the ledger: transcript parsing, condensing and the summary, on inline transcript text. */
import { expect, test } from "claude-code/testing";
import { suggestions } from "../../src/mod/advice.ts";
import { addRun, condense, parseTranscriptText, runFromStop, summary, tokenTotals } from "../../src/mod/ledger.ts";
import { inferJob, jobLabel } from "../../src/mod/infer.ts";
import type { Bucket, LedgerState, Run } from "../../src/mod/ledger.ts";
import { defaults } from "../../src/schema.ts";
import type { Settings } from "../../src/schema.ts";

const TRANSCRIPT = [
  { type: "user", timestamp: "2026-10-08T09:00:00.000Z", message: { content: "HAIKREW job=build lang=rust\nfix it" } },
  { type: "user", isMeta: true, timestamp: "2026-10-08T09:00:01.000Z", message: { content: "meta" } },
  { type: "assistant", timestamp: "2026-10-08T09:00:05.000Z",
    message: { id: "m1", model: "claude-haiku-5-5", usage: { input_tokens: 10, output_tokens: 4 },
      content: [{ type: "tool_use", id: "t1" }] } },
  { type: "assistant", timestamp: "2026-10-08T09:00:09.000Z",
    message: { id: "m1", model: "claude-haiku-5-5", usage: { input_tokens: 10, output_tokens: 4 },
      content: [{ type: "text", text: "Done.\nVERDICT: PASS" }] } },
].map((line) => JSON.stringify(line)).join("\n");

const run = (ts: string, quality: number, verdict: string): Run => ({
  ts, session: "s", agent_id: "a-" + ts, agent_type: "haiku-coder", model: "haiku", job: "build", lang: "rust",
  duration_s: 10, tokens_in: 5, tokens_out: 2, cache_read: 0, tool_calls: 1, attempts: 1, verdict, quality,
});

test("parseTranscriptText reads fields once per message id and skips meta user lines", () => {
  const t = parseTranscriptText(TRANSCRIPT);
  expect(t.job).toBe("build");
  expect(t.lang).toBe("rust");
  expect(t.model).toBe("claude-haiku-5-5");
  expect(t.tokens_in).toBe(10);
  expect(t.tokens_out).toBe(4);
  expect(t.tool_calls).toBe(1);
  expect(t.attempts).toBe(1);
  expect(t.duration_s).toBe(9);
  expect(t.verdict).toBe("pass");
  expect(t.quality).toBe(1);
});

test("parseTranscriptText gives blocked and unknown defaults for empty text", () => {
  const t = parseTranscriptText(JSON.stringify({ type: "assistant", message: { content: "STATUS: blocked" } }));
  expect(t.verdict).toBe("blocked");
  expect(t.job).toBe("unknown");
  expect(t.quality).toBe(0);
});

test("condense keeps the newest raw_limit runs and folds older ones by month, then by year", () => {
  const settings: Settings = { ...defaults(), ledger: { ...defaults().ledger, raw_limit: 2 } };
  const state: LedgerState = { runs: [], buckets: [] };
  let next = state;
  for (const ts of ["2020-01-05T00:00:00Z", "2026-10-01T00:00:00Z", "2026-10-02T00:00:00Z", "2026-10-03T00:00:00Z"]) {
    next = addRun(next, run(ts, 1, "pass"), settings);
  }
  expect(next.runs.map((r) => r.ts)).toEqual(["2026-10-02T00:00:00Z", "2026-10-03T00:00:00Z"]);
  const folded = condense(next, settings, new Date("2026-10-08T00:00:00Z"));
  expect(Object.fromEntries(folded.buckets.map((b) => [b.period, b.n]))).toEqual({ "2020": 1, "2026-10": 1 });
});

test("summary merges runs and buckets per model, job and lang, newest run first", () => {
  const settings: Settings = { ...defaults(), ledger: { ...defaults().ledger, raw_limit: 1 } };
  const state = [run("2026-10-01T00:00:00Z", 1, "pass"), run("2026-10-02T00:00:00Z", 0, "fail")]
    .reduce((s, r) => addRun(s, r, settings), { runs: [], buckets: [] } as LedgerState);
  const out = summary(state);
  expect(out.recent.map((r) => r.ts)).toEqual(["2026-10-02T00:00:00Z"]);
  expect(out.by_key).toEqual([expect.objectContaining({ model: "haiku", job: "build", lang: "rust", n: 2,
    quality_mean: 0.5, pass_rate: 0.5 })]);
});

test("addRun replaces an earlier record for the same agent", () => {
  const settings = defaults() as never;
  const base = { ts: "2026-10-08T00:00:00Z", session: "s", agent_type: "general", model: "unknown", job: "x",
    lang: "y", duration_s: 0, tokens_in: 0, tokens_out: 0, cache_read: 0, tool_calls: 0, attempts: 1,
    verdict: "none", quality: 0 };
  let state = addRun({ runs: [], buckets: [] }, { ...base, agent_id: "a1" } as never, settings);
  state = addRun(state, { ...base, agent_id: "a1", model: "claude-haiku-5-5", tokens_out: 417 } as never, settings);
  expect(state.runs.length).toBe(1);
  expect(state.runs[0].model).toBe("claude-haiku-5-5");
});

test("tokenTotals sums tokens and runs per model across runs", () => {
  const settings = defaults() as never;
  const base = { ts: "2026-10-08T09:00:00.000Z", session: "s", agent_type: "haiku-coder", job: "build", lang: "rust",
    duration_s: 1, cache_read: 0, tool_calls: 0, attempts: 1, verdict: "pass", quality: 1 };
  let state = addRun({ runs: [], buckets: [] }, { ...base, agent_id: "a1", model: "claude-haiku-5-5", tokens_in: 100, tokens_out: 10 } as never, settings);
  state = addRun(state, { ...base, agent_id: "a2", model: "claude-haiku-5-5", tokens_in: 100, tokens_out: 5 } as never, settings);
  expect(tokenTotals(state)).toEqual({ "claude-haiku-5-5": { tokens_in: 200, tokens_out: 15, runs: 2 } });
});

const group = (model: string, n: number, passes: number, lang = "rust"): Bucket => ({
  period: "2026-10", model, agent_type: "haiku-coder", job: "implement", lang, n, sum_quality: 0, sumsq_quality: 0,
  sum_tokens_in: 0, sum_tokens_out: 0, sum_duration: 0, passes,
});
const only = (...buckets: Bucket[]): LedgerState => ({ runs: [], buckets });

test("suggestions need four runs and a pass rate under 60%", () => {
  expect(suggestions(only(group("claude-haiku-5-5", 3, 0)), [])).toEqual([]);
  expect(suggestions(only(group("claude-haiku-5-5", 4, 3)), [])).toEqual([]);
  expect(suggestions(only(group("claude-haiku-5-5", 4, 2)), []).map((s) => s.rule))
    .toEqual(["job:implement+lang:rust=sonnet"]);
});

test("a sonnet group suggests opus and an opus group suggests nothing", () => {
  expect(suggestions(only(group("claude-sonnet-5", 4, 0)), []).map((s) => s.rule)).toEqual(["job:implement+lang:rust=opus"]);
  expect(suggestions(only(group("claude-opus-5", 4, 0)), [])).toEqual([]);
});

test("an existing rule that starts with the selector suppresses the suggestion", () => {
  expect(suggestions(only(group("claude-haiku-5-5", 4, 0)), ["job:implement+lang:rust=haiku"])).toEqual([]);
  expect(suggestions(only(group("claude-haiku-5-5", 4, 0)), ["job:review=sonnet"])).toHaveLength(1);
});

test("suggestion text is exact and omits the lang word when lang is empty", () => {
  expect(suggestions(only(group("claude-haiku-5-5", 4, 2)), [])).toEqual([{
    kind: "up",
    rule: "job:implement+lang:rust=sonnet",
    text: "implement rust on Haiku passed 50% of 4 runs",
  }]);
  expect(suggestions(only(group("claude-haiku-5-5", 4, 2, "")), [])[0].text)
    .toBe("implement on Haiku passed 50% of 4 runs");
});

test("suggestions never change the state they read", () => {
  const state = only(group("claude-haiku-5-5", 4, 0));
  const before = JSON.stringify(state);
  suggestions(state, []);
  expect(JSON.stringify(state)).toBe(before);
});

const reviews = (model: string, n: number, passes: number, job = "review"): Bucket =>
  ({ ...group(model, n, passes, ""), job });

test("a job a stronger model nearly always passes is offered one model down, replacing its rule", () => {
  const down = suggestions(only(reviews("claude-sonnet-5-5", 12, 12)), ["job:review=sonnet@high", "type:Explore=haiku"]);
  expect(down).toEqual([{ kind: "down", rule: "job:review=haiku@high", replaces: "job:review=sonnet@high",
    text: "review on Sonnet passed 100% of 12 runs; Haiku might do and costs less" }]);
  expect(suggestions(only(reviews("claude-sonnet-5-5", 7, 7)), [])).toEqual([]);
  expect(suggestions(only(reviews("claude-sonnet-5-5", 12, 10)), [])).toEqual([]);
  expect(suggestions(only(reviews("claude-haiku-5-5", 12, 12)), [])).toEqual([]);
});

test("no cheaper suggestion when the cheaper model already fails that job, nor for inferred jobs", () => {
  expect(suggestions(only(reviews("claude-sonnet-5-5", 12, 12), reviews("claude-haiku-5-5", 4, 1)), [])
    .filter((s) => s.kind === "down")).toEqual([]);
  expect(suggestions(only(reviews("claude-sonnet-5-5", 12, 12, "~review")), [])).toEqual([]);
  expect(suggestions(only(reviews("claude-haiku-5-5", 4, 0, "~review")), [])).toEqual([]);
});

test("an untagged run gets a job inferred from its prompt or agent type, marked as inferred", () => {
  expect(inferJob("Please review the diff in src/", "general-purpose")).toBe("~review");
  expect(inferJob("Fix the failing parser test", "haiku-coder")).toBe("~fix");
  expect(inferJob("What is in this folder?", "Explore")).toBe("~research");
  expect(inferJob("hello", "general-purpose")).toBe("unknown");
  expect(jobLabel("~review")).toBe("review (inferred)");
  expect(jobLabel("review")).toBe("review");
  const line = (o: unknown) => JSON.stringify(o);
  const text = [line({ type: "user", timestamp: "2026-10-12T10:00:00.000Z", message: { content: "Investigate why the build is slow" } }),
    line({ type: "assistant", timestamp: "2026-10-12T10:01:00.000Z", message: { id: "m1", model: "claude-haiku-5-5", content: [{ type: "text", text: "Done.\nVERDICT: PASS" }] } })].join("\n");
  expect(runFromStop({ agent_id: "a1", agent_type: "general-purpose" }, text).job).toBe("~research");
});
