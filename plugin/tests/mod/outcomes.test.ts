/** Mod tests for routing outcomes: grouping, judged and checked rates, late failures, escalations and paid tokens. */
import { expect, test } from "claude-code/testing";
import { outcomeStats } from "../../src/mod/outcomes.ts";
import type { Run } from "../../src/mod/ledger.ts";

const run = (over: Partial<Run>): Run => ({
  ts: "2026-10-08T09:00:00Z", session: "s", agent_id: "a-" + (over.ts ?? "2026-10-08T09:00:00Z"), agent_type: "haiku-coder",
  model: "claude-haiku-5-5", job: "implement", lang: "rust", duration_s: 10, tokens_in: 100, tokens_out: 50, cache_read: 0,
  cache_write: 0, tokens_estimated: true, tool_calls: 1, attempts: 1, verdict: "pass", quality: 1, ...over,
});

test("outcomeStats groups by model, job, language and size, cheapest model first, and rates over judged runs only", () => {
  const rows = outcomeStats([
    run({ verdict: "pass" }), run({ verdict: "fail", quality: 0 }), run({ verdict: "none", quality: 0 }),
    run({ model: "claude-sonnet-5-5", verdict: "pass" }),
    run({ lang: "ts", verdict: "pass" }),
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
  const sized = { ...run({ verdict: "pass" }), decision: { features: { size_level: "large" } } } as unknown as Run;
  const rows = outcomeStats([run({ verdict: "none" }), sized]);
  const unjudged = rows.find((r) => r.size_level === "");
  expect(unjudged?.pass_rate).toBeNull();
  expect(unjudged?.checked_pass_rate).toBeNull();
  expect(rows.find((r) => r.size_level === "large")?.pass_rate).toBe(1);
});

test("checked counts runs with a checker and rates them over their judged verdicts; late failures are counted", () => {
  const [row] = outcomeStats([
    run({ checked_by: "Ada", verdict: "pass" }), run({ checked_by: "Bo", verdict: "fail" }), run({ verdict: "pass" }),
    { ...run({ verdict: "pass" }), late_fail: true } as unknown as Run,
  ]);
  expect(row.checked).toBe(2);
  expect(row.checked_pass_rate).toBe(0.5);
  expect(row.late_fail).toBe(1);
  expect(row.pass_rate).toBe(0.75);
});

test("a run whose crew name reappears on a bigger model later counts as escalated, on the smaller model's group", () => {
  const rows = outcomeStats([
    run({ name: "Ada", ts: "2026-10-08T09:00:00Z", verdict: "fail", quality: 0 }),
    run({ name: "Ada", ts: "2026-10-08T10:00:00Z", model: "claude-sonnet-5-5", verdict: "pass" }),
    run({ name: "Bo", ts: "2026-10-08T09:00:00Z", verdict: "pass" }),
    run({ name: "Bo", ts: "2026-10-08T10:00:00Z", verdict: "pass" }),
    run({ name: "Cy", ts: "2026-10-08T09:00:00Z", model: "claude-sonnet-5-5", verdict: "pass" }),
    run({ name: "Cy", ts: "2026-10-08T10:00:00Z", verdict: "pass" }),
  ]);
  expect(rows.find((r) => r.model === "haiku")?.escalations).toBe(1);
  expect(rows.find((r) => r.model === "sonnet")?.escalations).toBe(0);
});

test("paid tokens per accepted result count Sonnet and Opus only; Haiku tokens are reported apart", () => {
  const rows = outcomeStats([
    run({ model: "claude-sonnet-5-5", tokens_in: 300, tokens_out: 100 }),
    run({ model: "claude-sonnet-5-5", tokens_in: 200, tokens_out: 0, verdict: "fail" }),
    run({ model: "claude-haiku-5-5", tokens_in: 40, tokens_out: 10 }),
    run({ model: "claude-haiku-5-5", tokens_in: 40, tokens_out: 10, verdict: "fail" }),
  ]);
  const sonnet = rows.find((r) => r.model === "sonnet");
  const haiku = rows.find((r) => r.model === "haiku");
  expect(sonnet?.paid_tokens).toBe(600);
  expect(sonnet?.paid_tokens_per_accepted).toBe(600);
  expect(haiku?.paid_tokens).toBe(0);
  expect(haiku?.haiku_tokens).toBe(100);
  expect(haiku?.paid_tokens_per_accepted).toBeNull();
});
