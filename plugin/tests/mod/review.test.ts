/** Review tiers: light, standard and deep choices, reviewer models, and the schema defaults the settings use. */
import { expect, test } from "claude-code/testing";
import { reviewPlan } from "../../src/mod/review.ts";
import type { ReviewInput, ReviewSettings } from "../../src/mod/review.ts";
import { SCHEMA, defaults, validate } from "../../src/schema.ts";

const CFG: ReviewSettings = {
  enabled: true,
  sensitive_paths: ["**/hooks/**", "**/auth/**", "**/*auth*", "**/*secur*", "**/*crypt*", "**/migrations/**",
    "**/*.lock", "**/.github/**", "**/Package.swift", "**/Cargo.toml", "**/package.json"],
  light_paths: ["**/*.md", "**/docs/**", "**/tests/**", "**/*.test.*", "**/*.spec.*", "**/test_*"],
  light_lines: 60,
  deep_lines: 400,
  standard_reviewer: "sonnet@medium",
  deep_reviewer: "opus@high",
  deep_jobs: ["security", "migration", "concurrency", "protocol"],
};

/** A finished agent that changed one plain source file of 120 lines and passed its tests. */
function input(over: Partial<ReviewInput> = {}): ReviewInput {
  return { job: "implement", lang: "ts", paths: ["src/mod/review.ts"], lines: 120, testsPassed: true, model: "sonnet", record: null, ...over };
}

test("a docs-only small change gets a light review, with no reviewer", () => {
  const plan = reviewPlan(input({ paths: ["docs/guide.md", "README.md"], lines: 20 }), CFG, false);
  expect(plan.tier).toBe("light");
  expect(plan.reviewer).toBe(null);
});

test("a change to plugin/hooks/register.ts is deep, and the reason names the path", () => {
  const plan = reviewPlan(input({ paths: ["plugin/hooks/register.ts"], lines: 10 }), CFG, true);
  expect(plan.tier).toBe("deep");
  expect(plan.reasons).toEqual(["plugin/hooks/register.ts matches sensitive path **/hooks/**"]);
  expect(plan.reviewer).toEqual({ model: "opus", effort: "high" });
});

test("a 500-line change is deep", () => {
  const plan = reviewPlan(input({ lines: 500 }), CFG, true);
  expect(plan.tier).toBe("deep");
  expect(plan.reasons).toEqual(["500 lines, at least 400"]);
});

test("failing tests make a change deep", () => {
  const plan = reviewPlan(input({ lines: 30, testsPassed: false }), CFG, true);
  expect(plan.tier).toBe("deep");
  expect(plan.reasons).toEqual(["tests failed"]);
});

test("a poor record makes a change deep, once there are four judged runs", () => {
  const poor = reviewPlan(input({ model: "haiku", job: "implement", lang: "ts", record: { judged: 5, passRate: 0.4 } }), CFG, true);
  expect(poor.tier).toBe("deep");
  expect(poor.reasons).toEqual(["Haiku passes 40% of implement/ts"]);
  const few = reviewPlan(input({ model: "haiku", record: { judged: 3, passRate: 0.0 } }), CFG, true);
  expect(few.tier).toBe("standard");
});

test("a plain src change of 120 lines is standard, reviewed by sonnet at medium effort", () => {
  const plan = reviewPlan(input(), CFG, false);
  expect(plan.tier).toBe("standard");
  expect(plan.reviewer).toEqual({ model: "sonnet", effort: "medium" });
});

test("a deep review without the Opus allowance falls back to sonnet at high effort", () => {
  const plan = reviewPlan(input({ paths: ["plugin/hooks/register.ts"] }), CFG, false);
  expect(plan.tier).toBe("deep");
  expect(plan.reviewer).toEqual({ model: "sonnet", effort: "high" });
  expect(plan.reasons).toContain("Opus not allowed");
});

test("a standard review on Opus also needs the Opus allowance", () => {
  const plan = reviewPlan(input(), { ...CFG, standard_reviewer: "opus@medium" }, false);
  expect(plan.tier).toBe("standard");
  expect(plan.reviewer).toEqual({ model: "sonnet", effort: "high" });
});

test("disabled review gives no tier", () => {
  const plan = reviewPlan(input(), { ...CFG, enabled: false }, true);
  expect(plan.tier).toBe("none");
  expect(plan.reviewer).toBe(null);
});

test("an agent that changed no files gets no review", () => {
  const plan = reviewPlan(input({ paths: [], lines: 0 }), CFG, true);
  expect(plan.tier).toBe("none");
  expect(plan.reasons).toEqual(["changed no files"]);
});

test("every review schema default validates", () => {
  const d = defaults().review ?? {};
  const fields = SCHEMA.review?.fields ?? {};
  expect(Object.keys(fields)).toEqual(["enabled", "sensitive_paths", "light_paths", "light_lines", "deep_lines",
    "standard_reviewer", "deep_reviewer", "deep_jobs"]);
  for (const key of Object.keys(fields)) expect(validate("review", key, d[key])).toBe(null);
  expect(d.deep_reviewer).toBe("opus@high");
  expect(d.standard_reviewer).toBe("sonnet@medium");
});
