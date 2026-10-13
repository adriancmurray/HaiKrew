/** Mod tests for outcome(): the one definition of how a run turned out, shared by every pass rate and insight. */
import { expect, test } from "claude-code/testing";
import { outcome } from "../../src/mod/ledger.ts";
import { bucketStats } from "../../src/mod/policy.ts";

test("outcome: checker verdicts count, self-reports and unchecked verdicts don't, a late failure always fails", () => {
  expect(outcome({ verdict: "pass", checked_by: "Ada" })).toBe("pass");
  expect(outcome({ verdict: "fail", checked_by: "Ada" })).toBe("fail");
  expect(outcome({ verdict: "pass" })).toBe(null);
  expect(outcome({})).toBe(null);
  expect(outcome({ verdict: "none", checked_by: "Ada" })).toBe(null);
  expect(outcome({ verdict: "pass", checked_by: "Ada", late_fail: true })).toBe("fail");
  expect(outcome({ late_fail: true })).toBe("fail");
});

test("bucketStats counts a checked pass that later failed as a judged failure", () => {
  const run = { model: "haiku", job: "implement", lang: "ts", verdict: "pass", checked_by: "Ada", late_fail: true };
  const [s] = bucketStats([run, { ...run, late_fail: false }], { job: "implement", lang: "ts", size: "?" });
  expect(s.judged).toBe(2);
  expect(s.passes).toBe(1);
  expect(s.late_fails).toBe(1);
});
