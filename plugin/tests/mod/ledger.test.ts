/** Mod tests for the ledger: transcript parsing, verdicts, token counts, condensing and the summary, on inline transcript text. */
import { expect, test } from "claude-code/testing";
import { suggestions } from "../../src/mod/advice.ts";
import { addRun, applyChecked, parseCheckerVerdict, byModel, combineUsage, condense, mergeRescanned, parseTranscriptText, readState, rescanRun, runFromStop,
  summary, tokenTotals, withLiveUsage } from "../../src/mod/ledger.ts";
import { inferJob, jobLabel } from "../../src/mod/infer.ts";
import type { Bucket, KeyStats, LedgerState, Run } from "../../src/mod/ledger.ts";
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
  duration_s: 10, tokens_in: 5, tokens_out: 2, cache_read: 0, cache_write: 0, tokens_estimated: true, tool_calls: 1,
  attempts: 1, verdict, quality,
});

const finalMessage = (text: string): string => JSON.stringify({ type: "assistant", message: { content: text } });
const verdictOf = (text: string): string => parseTranscriptText(finalMessage(text)).verdict;

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
  expect(t.tokens_estimated).toBe(true);
});

test("parseTranscriptText reads STATUS: blocked as fail and gives unknown defaults for empty text", () => {
  const t = parseTranscriptText(finalMessage("STATUS: blocked"));
  expect(t.verdict).toBe("fail");
  expect(t.job).toBe("unknown");
  expect(t.quality).toBe(0);
});

test("the last VERDICT or STATUS marker in the final message decides the verdict", () => {
  expect(verdictOf("Done.\nSTATUS: done")).toBe("pass");
  expect(verdictOf("status: DONE")).toBe("pass");
  expect(verdictOf("STATUS: blocked")).toBe("fail");
  expect(verdictOf("VERDICT: FAIL")).toBe("fail");
  expect(verdictOf("VERDICT: PASS\nSTATUS: blocked")).toBe("fail");
  expect(verdictOf("STATUS: blocked\nVERDICT: PASS")).toBe("pass");
  expect(verdictOf("VERDICT: PASSED")).toBe("none");
  expect(verdictOf("nothing to report")).toBe("none");
});

test("only the final assistant message with text sets the verdict", () => {
  const text = [finalMessage("VERDICT: PASS"), finalMessage("STATUS: blocked")].join("\n");
  expect(parseTranscriptText(text).verdict).toBe("fail");
});

test("a report handed back through SubagentHandback sets the verdict and the final report", () => {
  const handback = JSON.stringify({ type: "assistant", message: { id: "h1", content: [
    { type: "tool_use", id: "t9", name: "SubagentHandback", input: { message: "Built it.\nSTATUS: done\nVERDICT: PASS (all three)." } }] } });
  const text = [finalMessage("Let me check the tests."), handback].join("\n");
  expect(parseTranscriptText(text).verdict).toBe("pass");
  expect(parseTranscriptText(text.replace("VERDICT: PASS", "VERDICT: FAIL")).verdict).toBe("fail");
});

test("rescanRun keeps a reviewer's verdict", () => {
  const checked = { ...run("2026-10-08T09:00:00.000Z", 0, "fail"), checked_by: "Ada" };
  expect(rescanRun(checked, TRANSCRIPT)).toMatchObject({ verdict: "fail", quality: 0 });
});

test("parseTranscriptText counts cache writes into tokens in and marks the counts estimated", () => {
  const line = JSON.stringify({ type: "assistant", message: { id: "m2", content: "VERDICT: PASS",
    usage: { input_tokens: 3, cache_creation_input_tokens: 100, cache_read_input_tokens: 50, output_tokens: 9 } } });
  expect(parseTranscriptText(line)).toMatchObject({ tokens_in: 103, cache_write: 100, cache_read: 50, tokens_out: 9,
    tokens_estimated: true });
});

test("withLiveUsage takes live counts as final and folds cache writes into tokens in", () => {
  const live = withLiveUsage(run("2026-10-01T00:00:00Z", 1, "pass"), { input: 40, cacheWrite: 20, cacheRead: 300, output: 7 });
  expect(live).toMatchObject({ tokens_in: 60, cache_write: 20, cache_read: 300, tokens_out: 7, tokens_estimated: false });
});

test("rescanRun takes the transcript's output count only for runs not counted live", () => {
  const stored = { ...run("2026-10-08T09:00:00.000Z", 0, "none"), tokens_out: 2 };
  const rescanned = rescanRun(stored, TRANSCRIPT);
  expect(rescanned).toMatchObject({ ts: stored.ts, agent_id: stored.agent_id, verdict: "pass", quality: 1, tokens_out: 4,
    tokens_estimated: true });
  const live = withLiveUsage(stored, { input: 1, cacheWrite: 0, cacheRead: 0, output: 9 });
  expect(rescanRun(live, TRANSCRIPT)).toMatchObject({ verdict: "pass", quality: 1, tokens_out: 9, tokens_estimated: false });
});

test("combineUsage takes the live counts when the transcript saw no more input than they did", () => {
  const parsed = run("2026-10-01T00:00:00Z", 1, "pass");
  expect(combineUsage(parsed, { input: 40, cacheWrite: 20, cacheRead: 300, output: 7 }))
    .toEqual(withLiveUsage(parsed, { input: 40, cacheWrite: 20, cacheRead: 300, output: 7 }));
});

test("combineUsage keeps the larger count per field when the transcript saw more input, and the live output", () => {
  const parsed = { ...run("2026-10-01T00:00:00Z", 1, "pass"), tokens_in: 500, cache_write: 100, cache_read: 900, tokens_out: 30 };
  expect(combineUsage(parsed, { input: 40, cacheWrite: 20, cacheRead: 300, output: 7 })).toMatchObject({
    tokens_in: 500, cache_write: 100, cache_read: 900, tokens_out: 7, tokens_estimated: true,
  });
});

test("combineUsage keeps a live cache read that is larger, and the transcript's output when no live output was seen", () => {
  const parsed = { ...run("2026-10-01T00:00:00Z", 1, "pass"), tokens_in: 500, cache_write: 100, cache_read: 900, tokens_out: 30 };
  expect(combineUsage(parsed, { input: 40, cacheWrite: 20, cacheRead: 2000, output: 0 })).toMatchObject({
    tokens_in: 500, cache_write: 100, cache_read: 2000, tokens_out: 30, tokens_estimated: true,
  });
});

test("mergeRescanned replaces runs by agent id, keeps the others, and keeps a run stored after the rescan read the ledger", () => {
  const old = { ...run("2026-10-01T00:00:00Z", 0, "none"), agent_id: "a1" };
  const kept = { ...run("2026-10-02T00:00:00Z", 0, "none"), agent_id: "a2" };
  const added = { ...run("2026-10-03T00:00:00Z", 1, "pass"), agent_id: "a3" };
  const current: LedgerState = { runs: [old, kept, added], buckets: [] };
  const merged = mergeRescanned(current, [{ ...old, verdict: "pass", quality: 1 }, { ...kept, agent_id: "gone", verdict: "fail" }]);
  expect(merged).toEqual({ runs: [{ ...old, verdict: "pass", quality: 1 }, kept, added], buckets: [] });
});

test("mergeRescanned never matches a run with no agent id", () => {
  const unnamed = { ...run("2026-10-01T00:00:00Z", 0, "none"), agent_id: "" };
  expect(mergeRescanned({ runs: [unnamed], buckets: [] }, [{ ...unnamed, verdict: "pass" }]).runs).toEqual([unnamed]);
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
  expect(out.by_key).toEqual([expect.objectContaining({ model: "haiku", job: "build", lang: "rust", n: 2, judged: 2,
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

test("tokenTotals sums tokens, cache reads and runs per model across runs", () => {
  const settings = defaults() as never;
  const base = { ts: "2026-10-08T09:00:00.000Z", session: "s", agent_type: "haiku-coder", job: "build", lang: "rust",
    duration_s: 1, cache_read: 0, tool_calls: 0, attempts: 1, verdict: "pass", quality: 1 };
  let state = addRun({ runs: [], buckets: [] }, { ...base, agent_id: "a1", model: "claude-haiku-5-5", tokens_in: 100, tokens_out: 10 } as never, settings);
  state = addRun(state, { ...base, agent_id: "a2", model: "claude-haiku-5-5", tokens_in: 100, tokens_out: 5 } as never, settings);
  expect(tokenTotals(state)).toEqual({ "claude-haiku-5-5": { tokens_in: 200, tokens_out: 15, cache_read: 0, runs: 2 } });
});

const group = (model: string, n: number, passes: number, lang = "rust", none = 0): Bucket => ({
  period: "2026-10", model, agent_type: "haiku-coder", job: "implement", lang, n, sum_quality: 0, sumsq_quality: 0,
  sum_tokens_in: 0, sum_tokens_out: 0, sum_duration: 0, sum_cache_read: 0, passes, fails: n - passes - none,
});
const only = (...buckets: Bucket[]): LedgerState => ({ runs: [], buckets });

test("tokenTotals includes cache reads from runs and from buckets", () => {
  const state: LedgerState = {
    runs: [{ ...run("2026-10-01T00:00:00Z", 1, "pass"), model: "claude-haiku-5-5", cache_read: 30 },
      { ...run("2026-10-02T00:00:00Z", 1, "pass"), model: "claude-haiku-5-5", cache_read: 12 }],
    buckets: [{ ...group("claude-haiku-5-5", 2, 1), sum_cache_read: 5 }],
  };
  expect(tokenTotals(state)).toEqual({ "claude-haiku-5-5": { tokens_in: 10, tokens_out: 4, cache_read: 47, runs: 4 } });
});

test("pass rate is over judged runs: 2 pass, 1 fail and 5 none give judged 3 and pass rate 2/3", () => {
  const stats = summary(only(group("claude-haiku-5-5", 8, 2, "rust", 5))).by_key[0];
  expect(stats).toMatchObject({ n: 8, judged: 3, pass_rate: 2 / 3 });
});

test("byModel weights the pass rate by judged runs and reads 0 when none are judged", () => {
  const g = (n: number, judged: number, passRate: number): KeyStats => ({ model: "h", job: "j", lang: "l", n, judged,
    pass_rate: passRate, tokens_in_mean: 0, tokens_out_mean: 0, duration_mean: 0, quality_mean: 0, quality_stdev: 0 });
  expect(byModel([g(4, 2, 0.5), g(2, 0, 0)])).toEqual([expect.objectContaining({ model: "h", n: 6, judged: 2, pass_rate: 0.5 })]);
  expect(byModel([g(3, 0, 0)])).toEqual([expect.objectContaining({ n: 3, judged: 0, pass_rate: 0 })]);
});

test("readState reads an old stored run with verdict blocked as fail, and fills the fields older ledgers lack", () => {
  const oldRun = { ts: "2026-10-01T00:00:00Z", session: "s", agent_id: "a1", agent_type: "haiku-coder",
    model: "claude-haiku-5-5", job: "build", lang: "rust", duration_s: 10, tokens_in: 5, tokens_out: 2, cache_read: 0,
    tool_calls: 1, attempts: 1, verdict: "blocked", quality: 0 };
  const oldBucket = { period: "2026-09", model: "claude-haiku-5-5", agent_type: "haiku-coder", job: "build", lang: "rust",
    n: 4, sum_quality: 1, sumsq_quality: 1, sum_tokens_in: 9, sum_tokens_out: 9, sum_duration: 9, passes: 1 };
  const state = readState({ runs: [oldRun], buckets: [oldBucket] });
  expect(state.runs[0]).toMatchObject({ verdict: "fail", cache_write: 0, tokens_estimated: true });
  // Folded before fails were counted: its runs read as unjudged, so its one pass does not become a 100% pass rate.
  expect(state.buckets[0]).toMatchObject({ n: 4, passes: 0, fails: 0, sum_cache_read: 0 });
  expect(readState("not a ledger")).toEqual({ runs: [], buckets: [] });
});

test("suggestions need four judged runs and a pass rate under 60%", () => {
  expect(suggestions(only(group("claude-haiku-5-5", 3, 0)), [])).toEqual([]);
  expect(suggestions(only(group("claude-haiku-5-5", 4, 3)), [])).toEqual([]);
  expect(suggestions(only(group("claude-haiku-5-5", 4, 2)), []).map((s) => s.rule))
    .toEqual(["job:implement+lang:rust=sonnet"]);
});

test("a group with 10 runs and none of them judged gets no model suggestion", () => {
  expect(suggestions(only(group("claude-haiku-5-5", 10, 0, "rust", 10)), [])).toEqual([]);
});

test("the threshold counts judged runs, and the text says so", () => {
  expect(suggestions(only(group("claude-haiku-5-5", 10, 0, "rust", 6)), []).map((s) => s.text))
    .toEqual(["implement rust on Haiku passed 0% of 4 judged runs"]);
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
    text: "implement rust on Haiku passed 50% of 4 judged runs",
  }]);
  expect(suggestions(only(group("claude-haiku-5-5", 4, 2, "")), [])[0].text)
    .toBe("implement on Haiku passed 50% of 4 judged runs");
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
    text: "review on Sonnet passed 100% of 12 judged runs; Haiku might do and costs less" }]);
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

test("parseCheckerVerdict reads the last VERDICT line naming an agent", () => {
  expect(parseCheckerVerdict("VERDICT: FAIL for Ada\nlater\nVERDICT: PASS for Isaac Newline\nlooks fine")).toEqual({ verdict: "pass", name: "Isaac Newline" });
  expect(parseCheckerVerdict("VERDICT: PASS")).toBe(null);
  expect(parseCheckerVerdict("no verdict")).toBe(null);
});

test("applyChecked sets the newest matching run's verdict, quality and checker", () => {
  const a = { ...run("2026-10-01T00:00:00Z", 0, "none"), name: "Ada", attempts: 2 };
  const b = { ...run("2026-10-02T00:00:00Z", 0, "none"), name: "Ada", attempts: 2 };
  const c = { ...run("2026-10-03T00:00:00Z", 1, "pass"), name: "Other" };
  const state: LedgerState = { runs: [a, b, c], buckets: [] };
  const out = applyChecked(state, { name: "Ada" }, "pass", "Rev");
  expect(out.runs[0]).toEqual(a);
  expect(out.runs[1]).toMatchObject({ verdict: "pass", quality: 0.5, checked_by: "Rev" });
  expect(out.runs[2]).toEqual(c);
  expect(applyChecked(out, { name: "Ada" }, "fail", "Rev").runs[1]).toMatchObject({ verdict: "fail", quality: 0 });
  expect(applyChecked(state, { name: "Nobody" }, "pass", "Rev")).toEqual(state);
  expect(applyChecked(state, { agentId: c.agent_id }, "fail", "Rev").runs[2]).toMatchObject({ verdict: "fail" });
});
