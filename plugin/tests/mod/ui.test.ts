/** Pane formatting helpers and the per-model ledger rollup, on plain values. */
import { expect, test } from "claude-code/testing";
import { byModel } from "../../src/mod/ledger.ts";
import { compact, duration, fit, modelName, when } from "../../src/mod/ui.ts";
import { buildInstruction, buildRule, effortOf, readInstruction, readRule, ruleSentence, SQUEEZE_PRESETS, withEffort } from "../../src/mod/rules.ts";
import { SCHEMA } from "../../src/schema.ts";
import { latestLine } from "../../src/mod/pane-home.ts";

test("model ids read as names; unknown names pass through", () => {
  expect(modelName("claude-haiku-5-5")).toBe("Haiku 5.5");
  expect(modelName("claude-sonnet-5")).toBe("Sonnet 5");
  expect(modelName("claude-opus-4-1-20250805")).toBe("Opus 4.1");
  expect(modelName("gpt-x")).toBe("gpt-x");
  expect(modelName("")).toBe("unknown");
});

test("counts, durations and cells format short", () => {
  expect(compact(950)).toBe("950");
  expect(compact(12_400)).toBe("12k");
  expect(compact(1_250)).toBe("1.3k");
  expect(compact(3_100_000)).toBe("3.1M");
  expect(duration(48)).toBe("48s");
  expect(duration(72)).toBe("1m 12s");
  expect(duration(7500)).toBe("2h 05m");
  expect(fit("abcdef", 4)).toBe("abc…");
  expect(fit("ab", 4)).toBe("ab  ");
});

test("byModel weights each group by its runs", () => {
  const g = (model: string, n: number, pass: number, tin: number, dur: number) =>
    ({ model, job: "j", lang: "l", n, pass_rate: pass, tokens_in_mean: tin, tokens_out_mean: 0, duration_mean: dur, quality_mean: 0, quality_stdev: 0 });
  const out = byModel([g("h", 3, 1, 100, 10), g("h", 1, 0, 500, 50), g("s", 1, 1, 1, 1)]);
  expect(out.map((m) => m.model)).toEqual(["h", "s"]);
  expect(out[0]).toMatchObject({ n: 4, pass_rate: 0.75, tokens_mean: 200, duration_mean: 20 });
});

test("rules, instructions and efforts read as words and build back to the stored format", () => {
  const rule = "job:implement+lang:rust=sonnet@high";
  const r = readRule(rule);
  expect(buildRule(r.conds, r.model, r.effort)).toBe(rule);
  expect(ruleSentence(rule)).toBe("When job is implement and language is rust → Sonnet, high effort");
  const entry = "cwd:~/projects/*: never disable git hooks";
  const i = readInstruction(entry);
  expect(buildInstruction(i.conds, i.text)).toBe(entry);
  expect(withEffort(["haiku=low"], "sonnet", "max")).toEqual(["haiku=low", "sonnet=max"]);
  expect(effortOf(["sonnet=max"], "sonnet")).toBe("max");
  expect(SQUEEZE_PRESETS.map((p) => p.pattern)).toEqual(SCHEMA.squeeze.fields.patterns.default);
});

test("an agent's latest line is the first line of its newest assistant text", () => {
  expect(latestLine([{ role: "assistant", text: "Reading files" }, { role: "user", text: "ok" }, { role: "assistant", text: "\n  Running tests now\nmore" }]))
    .toBe("Running tests now");
  expect(latestLine([{ role: "user", text: "hi" }])).toBe("");
  expect(latestLine({ deny: "no" })).toBe("");
});

test("times read as spans, clock times or both", () => {
  const now = Date.UTC(2026, 9, 12, 15, 46);
  expect(when(now + (2 * 60 + 14) * 60000, now, "relative")).toBe("in 2 h 14 min");
  expect(when(new Date(now - 3 * 3600000).toISOString(), now, "relative")).toBe("3 h ago");
  expect(when((now + 35 * 60000) / 1000, now, "relative")).toBe("in 35 min");
  expect(when(now + 3 * 86400000, now, "relative")).toBe("in 3 days");
  expect(when(now + 3600000, now, "clock").startsWith("at ")).toBe(true);
  expect(when(now + 3600000, now, "both").startsWith("in 1 h (")).toBe(true);
  expect(when("not a time", now, "relative")).toBe("at an unknown time");
});
