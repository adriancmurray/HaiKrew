/** Mod tests for routing insights: Clef calibration, proposed rules against the current routing, and the findings. */
import { expect, test } from "claude-code/testing";
import { currentPick, insights } from "../../src/mod/insights.ts";
import type { Routing } from "../../src/mod/insights.ts";
import type { Run } from "../../src/mod/ledger.ts";

const run = (over: Partial<Run> & { picked?: string }): Run => {
  const { picked, ...fields } = over;
  const base: Run = {
    ts: "2026-10-08T09:00:00Z", session: "s", agent_id: "", agent_type: "haiku-coder", model: "claude-haiku-5-5", job: "implement",
    lang: "rust", duration_s: 10, tokens_in: 100, tokens_out: 50, cache_read: 0, cache_write: 0, tokens_estimated: true,
    tool_calls: 1, attempts: 1, verdict: "pass", quality: 1, ...fields,
  };
  return picked === undefined ? base : { ...base, decision: { model: picked } as unknown as Run["decision"] } as Run;
};

const passes = (n: number, over: Partial<Run> = {}): Run[] => Array.from({ length: n }, () => run({ verdict: "pass", ...over }));
const fails = (n: number, over: Partial<Run> = {}): Run[] => Array.from({ length: n }, () => run({ verdict: "fail", quality: 0, ...over }));
const SONNET_DEFAULT: Routing = { rules: [], defaultModel: "sonnet", allowOpus: false };

test("calibration counts over-escalations (a bigger pick where a smaller model passed) and under-escalations (Haiku picked, failed)", () => {
  const ins = insights([
    run({ picked: "sonnet", verdict: "pass" }),
    run({ picked: "haiku", verdict: "fail", quality: 0 }),
    run({ picked: "haiku", verdict: "pass", late_fail: true } as Partial<Run>),
    run({ picked: "opus", model: "claude-sonnet-5-5", verdict: "fail", quality: 0 }),
    run({ picked: "", verdict: "pass" }),
    run({ verdict: "fail", quality: 0 }),
  ], SONNET_DEFAULT);
  expect(ins.calibration).toEqual({ judged: 4, over: 1, under: 2 });
});

test("a rule is proposed when the cheapest model passing at least 0.8 of 8+ judged runs differs from the current pick", () => {
  const ins = insights([...passes(8), ...fails(1)], SONNET_DEFAULT);
  expect(ins.judged).toBe(9);
  expect(ins.rules).toHaveLength(1);
  expect(ins.rules[0]).toMatchObject({ rule: "job:implement+lang:rust=haiku", model: "haiku", current: "sonnet",
    evidence: "haiku passed 8 of 9 judged runs" });
  expect(ins.findings[0]).toMatchObject({ count: 9 });
});

test("no rule when the current rules already pick that model, or when a model has fewer than 8 judged runs", () => {
  const data = [...passes(8), ...fails(1)];
  expect(insights(data, { rules: ["job:implement+lang:rust=haiku"], defaultModel: "sonnet", allowOpus: false }).rules).toEqual([]);
  expect(insights(data, { rules: [], defaultModel: "haiku", allowOpus: false }).rules).toEqual([]);
  expect(insights(passes(7), SONNET_DEFAULT).rules).toEqual([]);
});

test("Opus is proposed only when Opus is allowed", () => {
  const data = [...fails(8, { model: "claude-haiku-5-5" }), ...fails(8, { model: "claude-sonnet-5-5" }), ...passes(8, { model: "claude-opus-5-5" })];
  expect(insights(data, { rules: [], defaultModel: "haiku", allowOpus: false }).rules).toEqual([]);
  const allowed = insights(data, { rules: [], defaultModel: "haiku", allowOpus: true }).rules;
  expect(allowed.map((r) => r.rule)).toEqual(["job:implement+lang:rust=opus"]);
});

test("findings are at most five, most evidence first, and an empty ledger has none", () => {
  const many = [
    ...Array.from({ length: 6 }, () => run({ picked: "sonnet", verdict: "pass" })),
    ...Array.from({ length: 2 }, () => run({ picked: "haiku", verdict: "fail", quality: 0 })),
    ...passes(20, { job: "review", lang: "ts" }),
    ...passes(10, { job: "research", lang: "sbpl" }),
    ...passes(9, { job: "build", lang: "go" }),
    ...passes(8, { job: "audit", lang: "ts" }),
    ...fails(3, { job: "fix", lang: "zsh" }),
    ...passes(1, { job: "docs", lang: "md" }),
  ];
  const { findings } = insights(many, SONNET_DEFAULT);
  expect(findings.map((f) => f.count)).toEqual([20, 10, 9, 8, 6]);
  expect(findings[0].text).toMatch(/haiku passed 20 of 20 judged runs on review \/ ts/);
  expect(insights([], SONNET_DEFAULT)).toEqual({ judged: 0, calibration: { judged: 0, over: 0, under: 0 }, rules: [], findings: [], checkerCatch: [] });
});

test("the checker catch rate rides along in the insights, over the checked runs with a defect count", () => {
  const ins = insights([
    run({ checked_by: "Ada", checker_defects: 1 }),
    run({ checked_by: "Bo", checker_defects: 0 }),
    run({ checked_by: "Cy" }),
  ], SONNET_DEFAULT);
  expect(ins.checkerCatch).toEqual([{ job: "implement", lang: "rust", size_level: "", checked: 2, with_defects: 1, rate: 0.5 }]);
});

test("currentPick takes the first rule whose conditions hold for the job and language, else the default", () => {
  expect(currentPick(["type:Explore=haiku", "job:implement=sonnet@high"], "haiku", "implement", "rust")).toBe("sonnet");
  expect(currentPick(["type:Explore=haiku"], "opus", "implement", "rust")).toBe("opus");
});
