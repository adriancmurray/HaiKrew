/** Mod tests for routing outcomes: grouping, judged and checked rates, late failures, escalations and paid tokens. */
import { expect, test } from "claude-code/testing";
import { checkerBucket, checkerCatch, outcomeStats } from "../../src/mod/outcomes.ts";
import type { Run } from "../../src/mod/ledger.ts";

const run = (over: Partial<Run>): Run => ({
  ts: "2026-10-08T09:00:00Z", session: "s", agent_id: "a-" + (over.ts ?? "2026-10-08T09:00:00Z"), agent_type: "haiku-coder",
  model: "claude-haiku-5-5", job: "implement", lang: "rust", duration_s: 10, tokens_in: 100, tokens_out: 50, cache_read: 0,
  cache_write: 0, tokens_estimated: true, tool_calls: 1, attempts: 1, verdict: "pass", quality: 1, ...over,
});

const judgedRun = (over: Partial<Run>): Run => run({ checked_by: "Rev", ...over });

test("outcomeStats groups by model, job, language and size, cheapest model first, and rates over judged runs only", () => {
  const rows = outcomeStats([
    judgedRun({ verdict: "pass" }), judgedRun({ verdict: "fail", quality: 0 }), judgedRun({ verdict: "none", quality: 0 }),
    judgedRun({ model: "claude-sonnet-5-5", verdict: "pass" }),
    judgedRun({ lang: "ts", verdict: "pass" }),
  ]);
  expect(rows.map((r) => `${r.model}/${r.job}/${r.lang}`)).toEqual(["haiku/implement/rust", "haiku/implement/ts", "sonnet/implement/rust"]);
  const haiku = rows[0];
  expect(haiku.runs).toBe(3);
  expect(haiku.judged).toBe(2);
  expect(haiku.passed).toBe(1);
  expect(haiku.pass_rate).toBe(0.5);
  expect(rows[1].pass_rate).toBe(1);
});

test("a group with nothing judged has null rates, and a group's size level is kept apart when the decider gave one", () => {
  const sized = { ...judgedRun({ verdict: "pass" }), decision: { features: { size_level: "large" } } } as unknown as Run;
  const rows = outcomeStats([run({ verdict: "none" }), sized]);
  const unjudged = rows.find((r) => r.size_level === "");
  expect(unjudged?.pass_rate).toBeNull();
  expect(unjudged?.checked_pass_rate).toBeNull();
  expect(rows.find((r) => r.size_level === "large")?.pass_rate).toBe(1);
});

test("checked counts runs with a checker and rates them over their judged verdicts; late failures are counted", () => {
  const [row] = outcomeStats([
    judgedRun({ checked_by: "Ada", verdict: "pass" }), judgedRun({ checked_by: "Bo", verdict: "fail" }), run({ verdict: "pass" }),
    { ...run({ verdict: "pass" }), late_fail: true } as unknown as Run,
  ]);
  expect(row.checked).toBe(2);
  expect(row.checked_pass_rate).toBe(0.5);
  expect(row.late_fail).toBe(1);
  expect(row.pass_rate).toBe(0.5);
});

test("a run whose crew name reappears on a bigger model later counts as escalated, on the smaller model's group", () => {
  const rows = outcomeStats([
    judgedRun({ name: "Ada", ts: "2026-10-08T09:00:00Z", verdict: "fail", quality: 0 }),
    judgedRun({ name: "Ada", ts: "2026-10-08T10:00:00Z", model: "claude-sonnet-5-5", verdict: "pass" }),
    judgedRun({ name: "Bo", ts: "2026-10-08T09:00:00Z", verdict: "pass" }),
    judgedRun({ name: "Bo", ts: "2026-10-08T10:00:00Z", verdict: "pass" }),
    judgedRun({ name: "Cy", ts: "2026-10-08T09:00:00Z", model: "claude-sonnet-5-5", verdict: "pass" }),
    judgedRun({ name: "Cy", ts: "2026-10-08T10:00:00Z", verdict: "pass" }),
  ]);
  expect(rows.find((r) => r.model === "haiku")?.escalations).toBe(1);
  expect(rows.find((r) => r.model === "sonnet")?.escalations).toBe(0);
});

test("checkerCatch groups checked runs by job, language and size, most checked first, with the share that had a defect", () => {
  const sized = (over: Partial<Run>, size: string) => ({ ...run(over), decision: { features: { size_level: size } } } as unknown as Run);
  const rows = checkerCatch([
    run({ checked_by: "Ada", checker_defects: 0 }),
    run({ checked_by: "Bo", checker_defects: 2 }),
    run({ checked_by: "Cy", checker_defects: 1 }),
    sized({ checked_by: "Di", checker_defects: 0 }, "large"),
    run({ job: "review", checked_by: "Ed", checker_defects: 0 }),
  ]);
  expect(rows).toEqual([
    { job: "implement", lang: "rust", size_level: "", checked: 3, with_defects: 2, rate: 2 / 3 },
    { job: "implement", lang: "rust", size_level: "large", checked: 1, with_defects: 0, rate: 0 },
    { job: "review", lang: "rust", size_level: "", checked: 1, with_defects: 0, rate: 0 },
  ]);
});

test("checkerCatch leaves out runs with no checker or no recorded defect count; they are unknown, not clean", () => {
  expect(checkerCatch([
    judgedRun({ verdict: "pass" }),
    run({ checker_defects: 0 }),
    run({ checked_by: "Ada" }),
    run({ checked_by: "Bo", checker_defects: 0 }),
  ])).toEqual([{ job: "implement", lang: "rust", size_level: "", checked: 1, with_defects: 0, rate: 0 }]);
  expect(checkerCatch([judgedRun({ verdict: "pass" })])).toEqual([]);
});

/** A run at hour `h` of 2026-10-08, for the checker bucket's oldest-first walk. */
const at = (h: number, over: Partial<Run> = {}): Run => run({ ts: `2026-10-08T${String(h).padStart(2, "0")}:00:00Z`, ...over });

test("checkerBucket counts the clean checked runs since the last defect, for one job, language and size", () => {
  const runs = [
    at(9, { checked_by: "Ada", checker_defects: 0 }),
    at(10, { checked_by: "Bo", checker_defects: 0 }),
    at(11, { checked_by: "Cy" }),
    at(12, { lang: "ts", checked_by: "Di", checker_defects: 0 }),
  ];
  expect(checkerBucket(runs, "implement", "rust", "")).toEqual({ checked: 2, skipped: 0 });
  expect(checkerBucket(runs, "implement", "ts", "")).toEqual({ checked: 1, skipped: 0 });
  expect(checkerBucket(runs, "implement", "rust", "large")).toEqual({ checked: 0, skipped: 0 });
});

test("a checker-found defect resets the clean count, and the skipped count too", () => {
  const runs = [
    at(9, { checked_by: "Ada", checker_defects: 0 }),
    at(10, { checked_by: "Bo", checker_defects: 0 }),
    at(11, { checked_by: "Cy", checker_defects: 2 }),
    at(12, { checked_by: "Di", checker_defects: 0 }),
  ];
  expect(checkerBucket(runs, "implement", "rust", "")).toEqual({ checked: 1, skipped: 0 });
  expect(checkerBucket([...runs, at(13, { checker_skipped: true })], "implement", "rust", "")).toEqual({ checked: 1, skipped: 1 });
  const defectLast = [at(9, { checker_skipped: true }), at(10, { checked_by: "Bo", checker_defects: 1 })];
  expect(checkerBucket(defectLast, "implement", "rust", "")).toEqual({ checked: 0, skipped: 0 });
});

test("a checked run resets the skipped count, and skipped runs count since the last checked run", () => {
  const runs = [
    at(9, { checked_by: "Ada", checker_defects: 0 }),
    at(10, { checker_skipped: true }),
    at(11, { checker_skipped: true }),
  ];
  expect(checkerBucket(runs, "implement", "rust", "")).toEqual({ checked: 1, skipped: 2 });
  expect(checkerBucket([...runs, at(12, { checked_by: "Bo", checker_defects: 0 }), at(13, { checker_skipped: true })],
    "implement", "rust", "")).toEqual({ checked: 2, skipped: 1 });
});

test("checkerBucket walks the runs oldest first, whatever order they come in", () => {
  const runs = [
    at(12, { checker_skipped: true }),
    at(10, { checked_by: "Bo", checker_defects: 4 }),
    at(9, { checked_by: "Ada", checker_defects: 0 }),
    at(11, { checked_by: "Cy", checker_defects: 0 }),
  ];
  expect(checkerBucket(runs, "implement", "rust", "")).toEqual({ checked: 1, skipped: 1 });
});

test("paid tokens per accepted result count Sonnet and Opus only; Haiku tokens are reported apart", () => {
  const rows = outcomeStats([
    judgedRun({ model: "claude-sonnet-5-5", tokens_in: 300, tokens_out: 100, verdict: "pass" }),
    judgedRun({ model: "claude-sonnet-5-5", tokens_in: 200, tokens_out: 0, verdict: "fail" }),
    run({ model: "claude-haiku-5-5", tokens_in: 40, tokens_out: 10 }),
    judgedRun({ model: "claude-haiku-5-5", tokens_in: 40, tokens_out: 10, verdict: "fail" }),
  ]);
  const sonnet = rows.find((r) => r.model === "sonnet");
  const haiku = rows.find((r) => r.model === "haiku");
  expect(sonnet?.paid_tokens).toBe(600);
  expect(sonnet?.paid_tokens_per_accepted).toBe(600);
  expect(haiku?.paid_tokens).toBe(0);
  expect(haiku?.haiku_tokens).toBe(100);
  expect(haiku?.paid_tokens_per_accepted).toBeNull();
});
