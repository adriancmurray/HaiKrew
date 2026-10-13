/** Mod tests for the model policy: the smoothed rate, each branch of the pick, exploration and the bucket's stats. */
import { expect, test } from "claude-code/testing";
import { bucketStats, chooseModel, successRate } from "../../src/mod/policy.ts";
import type { BucketStat, PolicyCfg, PolicyRun } from "../../src/mod/policy.ts";

const NO_EXPLORE: PolicyCfg = { explore_rate: 0 };
const stat = (model: string, judged: number, passes: number, late_fails = 0): BucketStat =>
  ({ model, runs: judged, judged, passes, late_fails });
const clef = (model: string) => ({ model });

test("successRate smooths by one pass and two counted runs, and counts late fails as runs that did not pass", () => {
  expect(successRate(stat("haiku", 0, 0))).toBe(0.5);
  expect(successRate(stat("haiku", 8, 8))).toBe(0.9);
  expect(successRate(stat("haiku", 11, 8, 3))).toBe(9 / 13);
});

test("8 judged passes and 3 self-only late fails is 8 of 11 counted, never negative", () => {
  const runs: PolicyRun[] = [
    ...Array.from({ length: 8 }, () => run({ verdict: "pass", decision: small })),
    ...Array.from({ length: 3 }, () => run({ verdict: undefined, checked_by: undefined, late_fail: true, decision: small })),
  ];
  const [s] = bucketStats(runs, { job: "implement", lang: "ts", size: "small" });
  expect(s).toMatchObject({ judged: 11, passes: 8, late_fails: 3 });
  expect(successRate(s)).toBe(9 / 13);
  const onlyLate = bucketStats(runs.slice(8), { job: "implement", lang: "ts", size: "small" })[0];
  expect(successRate(onlyLate)).toBe(1 / 5);
});

test("the cheapest model at or above target_pass wins once some model has min_runs judged", () => {
  const stats = [stat("haiku", 10, 6), stat("sonnet", 10, 9), stat("opus", 10, 10)];
  const p = chooseModel({ clef: clef("opus"), bucketStats: stats, explore: 1, cfg: NO_EXPLORE });
  expect(p).toEqual({ model: "sonnet", source: "data", explored: false, reason: p.reason });
  expect(p.reason).toContain("sonnet");
  expect(chooseModel({ clef: null, bucketStats: [stat("haiku", 10, 9)], explore: 1, cfg: NO_EXPLORE }).model).toBe("haiku");
});

test("target_pass and min_runs come from the settings, with defaults of 0.8 and 8", () => {
  const stats = [stat("haiku", 10, 9)];
  expect(chooseModel({ clef: clef("sonnet"), bucketStats: stats, explore: 1, cfg: { ...NO_EXPLORE, target_pass: 0.9 } }).source).toBe("clef");
  expect(chooseModel({ clef: null, bucketStats: [stat("haiku", 7, 7)], explore: 1, cfg: NO_EXPLORE }).model).toBe(null);
  expect(chooseModel({ clef: null, bucketStats: [stat("haiku", 7, 7)], explore: 1, cfg: { ...NO_EXPLORE, min_runs: 7 } }).source).toBe("data");
});

test("with no model at min_runs judged, the data is ignored and Clef's confident pick stands", () => {
  const p = chooseModel({ clef: clef("sonnet"), bucketStats: [stat("haiku", 7, 7)], explore: 1, cfg: NO_EXPLORE });
  expect(p.model).toBe("sonnet");
  expect(p.source).toBe("clef");
});

test("a data pick needs min_runs judged runs in the model it picks: haiku 3/3 does not beat sonnet 8/8", () => {
  const p = chooseModel({ clef: clef("opus"), bucketStats: [stat("haiku", 3, 3), stat("sonnet", 8, 8)], explore: 1, cfg: NO_EXPLORE });
  expect(p).toMatchObject({ model: "sonnet", source: "data", explored: false });
  const below = chooseModel({ clef: clef("opus"), bucketStats: [stat("haiku", 3, 3), stat("sonnet", 8, 4)], explore: 1, cfg: NO_EXPLORE });
  expect(below).toMatchObject({ model: "opus", source: "clef" });
});

test("when data exists but no model reaches the target, Clef's pick stands", () => {
  const stats = [stat("haiku", 10, 3), stat("sonnet", 2, 0)];
  const p = chooseModel({ clef: clef("opus"), bucketStats: stats, explore: 1, cfg: NO_EXPLORE });
  expect(p.model).toBe("opus");
  expect(p.source).toBe("clef");
});

test("late fails lower the rate: 8 passes and 3 late fails of 11 counted is 0.69, below the target", () => {
  const p = chooseModel({ clef: clef("sonnet"), bucketStats: [stat("haiku", 11, 8, 3)], explore: 1, cfg: NO_EXPLORE });
  expect(p.source).toBe("clef");
  expect(p.model).toBe("sonnet");
});

test("with no data and no confident pick the gate's default stands, and nothing is explored", () => {
  const p = chooseModel({ clef: null, bucketStats: [], explore: 0, cfg: { explore_rate: 1 } });
  expect(p).toEqual({ model: null, source: "default", explored: false, reason: p.reason });
  expect(chooseModel({ clef: { model: undefined }, bucketStats: [stat("haiku", 1, 1)], explore: 0, cfg: { explore_rate: 1 } }).model).toBe(null);
});

test("a pick above haiku runs one model cheaper when explore is below explore_rate, marked explored", () => {
  const opus = { model: "opus", probs: { sonnet: 0.3, opus: 0.7 } };
  const p = chooseModel({ clef: opus, bucketStats: [], explore: 0.05, cfg: { explore_rate: 0.1 } });
  expect(p).toMatchObject({ model: "sonnet", source: "clef", explored: true });
  expect(p.reason).toContain("exploring sonnet");
  const data = chooseModel({ clef: null, bucketStats: [stat("sonnet", 10, 10)], explore: 0, cfg: { explore_rate: 0.1 } });
  expect(data).toMatchObject({ model: "haiku", source: "data", explored: true });
});

test("a Clef pick explores the cheaper model only when Clef gives it at least 0.25", () => {
  const cfg = { explore_rate: 0.1 };
  const low = { model: "opus", probs: { sonnet: 0.24, opus: 0.76 } };
  expect(chooseModel({ clef: low, bucketStats: [], explore: 0, cfg })).toMatchObject({ model: "opus", source: "clef", explored: false });
  const at = { model: "opus", probs: { sonnet: 0.25, opus: 0.75 } };
  expect(chooseModel({ clef: at, bucketStats: [], explore: 0, cfg })).toMatchObject({ model: "sonnet", source: "clef", explored: true });
  const none = { model: "opus" };
  expect(chooseModel({ clef: none, bucketStats: [], explore: 0, cfg })).toMatchObject({ model: "opus", explored: false });
});

test("a ledger pick explores at explore_rate whatever Clef's probability for the cheaper model", () => {
  const cfg = { explore_rate: 0.1 };
  const lowClef = { model: "sonnet", probs: { haiku: 0.01, sonnet: 0.99 } };
  const p = chooseModel({ clef: lowClef, bucketStats: [stat("sonnet", 10, 10)], explore: 0, cfg });
  expect(p).toMatchObject({ model: "haiku", source: "data", explored: true });
  expect(chooseModel({ clef: lowClef, bucketStats: [stat("sonnet", 10, 10)], explore: 0.5, cfg })).toMatchObject({ model: "sonnet", explored: false });
});

test("exploration needs explore below explore_rate, so explore equal to the rate does not explore", () => {
  const p = chooseModel({ clef: clef("opus"), bucketStats: [], explore: 0.1, cfg: { explore_rate: 0.1 } });
  expect(p).toMatchObject({ model: "opus", explored: false });
});

test("haiku is never explored, and a pick is kept when explore_rate is 0", () => {
  expect(chooseModel({ clef: clef("haiku"), bucketStats: [], explore: 0, cfg: { explore_rate: 1 } })).toMatchObject({ model: "haiku", explored: false });
  expect(chooseModel({ clef: clef("sonnet"), bucketStats: [], explore: 0, cfg: NO_EXPLORE })).toMatchObject({ model: "sonnet", explored: false });
});

const run = (over: Partial<PolicyRun>): PolicyRun => ({ model: "haiku", job: "implement", lang: "ts", verdict: "pass", checked_by: "Rev", ...over });
const small = { features: { size_level: "small" } };

test("bucketStats leaves out a run's own self-reported verdict, which no checker has judged", () => {
  const selfOnly: PolicyRun = { model: "haiku", job: "implement", lang: "ts", self_verdict: "pass", decision: small } as PolicyRun;
  const [stat] = bucketStats([selfOnly, run({ verdict: "pass", decision: small })], { job: "implement", lang: "ts", size: "small" });
  expect(stat).toMatchObject({ runs: 2, judged: 1, passes: 1 });
});

test("bucketStats counts only runs in the job, lang and size bucket, by model", () => {
  const runs: PolicyRun[] = [
    run({ verdict: "pass", decision: small }),
    run({ verdict: "fail", decision: small }),
    run({ verdict: "none", decision: small }),
    run({ model: "sonnet", verdict: "pass", late_fail: true, decision: small }),
    run({ verdict: "pass" }),
    run({ job: "review", verdict: "pass", decision: small }),
    run({ lang: "rust", verdict: "pass", decision: small }),
    run({ verdict: "pass", decision: { features: { size_level: "large" } } }),
  ];
  const stats = bucketStats(runs, { job: "implement", lang: "ts", size: "small" });
  expect(stats.find((s) => s.model === "haiku")).toEqual({ model: "haiku", runs: 3, judged: 2, passes: 1, late_fails: 0 });
  expect(stats.find((s) => s.model === "sonnet")).toEqual({ model: "sonnet", runs: 1, judged: 1, passes: 0, late_fails: 1 });
  expect(stats.length).toBe(2);
});

test("bucketStats files runs with no features under size '?', and reads no late_fail as 0", () => {
  const runs: PolicyRun[] = [run({ verdict: "pass" }), run({ verdict: "fail" })];
  expect(bucketStats(runs, { job: "implement", lang: "ts", size: "?" })).toEqual([
    { model: "haiku", runs: 2, judged: 2, passes: 1, late_fails: 0 },
  ]);
  expect(bucketStats(runs, { job: "implement", lang: "ts", size: "small" })).toEqual([]);
});
