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
  light_reviewer: "checker",
  deep_lines: 400,
  standard_reviewer: "sonnet@medium",
  deep_reviewer: "opus@high",
  deep_inline: false,
  deep_jobs: ["security", "migration", "concurrency", "protocol"],
};

/** The settings with the main model allowed to review deep changes itself. */
const INLINE: ReviewSettings = { ...CFG, deep_inline: true };

/** A finished agent that changed one plain source file of 120 lines and passed its tests. */
function input(over: Partial<ReviewInput> = {}): ReviewInput {
  return { job: "implement", lang: "ts", paths: ["src/mod/review.ts"], lines: 120, testsPassed: true, model: "sonnet", record: null, ...over };
}

/** A change that is deep by its path, so the deep reviewer decides how it is checked. */
const SENSITIVE = { paths: ["plugin/hooks/register.ts"], lines: 10 };

test("a docs-only small change gets a light review, checked by the Haiku checker agent", () => {
  const plan = reviewPlan(input({ paths: ["docs/guide.md", "README.md"], lines: 20 }), CFG, false);
  expect(plan.tier).toBe("light");
  expect(plan.reviewer).toEqual({ model: "haiku", effort: "medium", agent: "haikrew:haiku-checker" });
});

test("a light review with light_reviewer inline has no reviewer: the main model glances", () => {
  const plan = reviewPlan(input({ paths: ["docs/guide.md"], lines: 20 }), { ...CFG, light_reviewer: "inline" }, false);
  expect(plan.tier).toBe("light");
  expect(plan.reviewer).toBe(null);
});

test("a light review with the checker names the checker agent and keeps the light reason", () => {
  const plan = reviewPlan(input({ paths: ["tests/mod/a.test.ts"], lines: 12 }), CFG, false);
  expect(plan.reasons).toEqual(["only light paths changed, 12 lines"]);
  expect(plan.reviewer).toEqual({ model: "haiku", effort: "medium", agent: "haikrew:haiku-checker" });
});

test("a change to plugin/hooks/register.ts is deep, and the reason names the path", () => {
  const plan = reviewPlan(input(SENSITIVE), CFG, true);
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

test("with deep_inline on, a deep review stays inline when the main model is at least as strong as the deep reviewer", () => {
  const plan = reviewPlan(input({ ...SENSITIVE, mainModel: "claude-opus-5" }), INLINE, true);
  expect(plan.tier).toBe("deep");
  expect(plan.reviewer).toBe("inline");
  expect(plan.reasons).toEqual([
    "plugin/hooks/register.ts matches sensitive path **/hooks/**",
    "reviewed inline: Opus is at least as strong as Opus",
  ]);
});

test("with deep_inline off (the default), a deep review goes to the deep reviewer even when the main model is Opus", () => {
  const plan = reviewPlan(input({ ...SENSITIVE, mainModel: "claude-opus-5" }), CFG, true);
  expect(plan.tier).toBe("deep");
  expect(plan.reviewer).toEqual({ model: "opus", effort: "high" });
  expect(plan.reasons).toEqual(["plugin/hooks/register.ts matches sensitive path **/hooks/**"]);
  expect(reviewPlan(input({ ...SENSITIVE, mainModel: "claude-sonnet-5" }), { ...CFG, deep_reviewer: "sonnet@high" }, false).reviewer)
    .toEqual({ model: "sonnet", effort: "high" });
});

test("the model rank ignores case and reads the family inside a full model id", () => {
  expect(reviewPlan(input({ ...SENSITIVE, mainModel: "CLAUDE-OPUS-5" }), INLINE, true).reviewer).toBe("inline");
  expect(reviewPlan(input({ ...SENSITIVE, mainModel: "Claude-Sonnet-5" }), { ...INLINE, deep_reviewer: "SONNET@high" }, true).reviewer).toBe("inline");
});

test("a weaker main model leaves the deep review to the deep reviewer", () => {
  const sonnet = reviewPlan(input({ ...SENSITIVE, mainModel: "claude-sonnet-5" }), CFG, true);
  expect(sonnet.reviewer).toEqual({ model: "opus", effort: "high" });
  const haiku = reviewPlan(input({ ...SENSITIVE, mainModel: "claude-haiku-5-5" }), CFG, true);
  expect(haiku.reviewer).toEqual({ model: "opus", effort: "high" });
});

test("a main model that names no known family, or none at all, does not review inline", () => {
  expect(reviewPlan(input({ ...SENSITIVE, mainModel: "inherit" }), CFG, true).reviewer).toEqual({ model: "opus", effort: "high" });
  expect(reviewPlan(input(SENSITIVE), CFG, true).reviewer).toEqual({ model: "opus", effort: "high" });
});

test("a sonnet main model reviews inline for a sonnet deep reviewer, and an opus one does too", () => {
  const cfg = { ...INLINE, deep_reviewer: "sonnet@high" };
  expect(reviewPlan(input({ ...SENSITIVE, mainModel: "claude-sonnet-5" }), cfg, false).reviewer).toBe("inline");
  expect(reviewPlan(input({ ...SENSITIVE, mainModel: "claude-opus-5" }), cfg, false).reviewer).toBe("inline");
});

test("without the Opus allowance, the reviewer that would run is Sonnet, so a Sonnet main model reviews inline", () => {
  const plan = reviewPlan(input({ ...SENSITIVE, mainModel: "claude-sonnet-5" }), INLINE, false);
  expect(plan.reviewer).toBe("inline");
  expect(plan.reasons).not.toContain("Opus not allowed");
});

test("a standard review keeps its cheaper reviewer even when the main model is Opus", () => {
  const plan = reviewPlan(input({ mainModel: "claude-opus-5" }), CFG, true);
  expect(plan.tier).toBe("standard");
  expect(plan.reviewer).toEqual({ model: "sonnet", effort: "medium" });
});

test("a job equal to a deep job, or starting with one and a - or _, is deep", () => {
  const dash = reviewPlan(input({ job: "security-review" }), CFG, true);
  expect(dash.tier).toBe("deep");
  expect(dash.reasons).toEqual(["job security-review always gets a deep review"]);
  expect(reviewPlan(input({ job: "security_audit" }), CFG, true).tier).toBe("deep");
  expect(reviewPlan(input({ job: "migration" }), CFG, true).tier).toBe("deep");
});

test("a job that only shares a prefix with a deep job is not deep", () => {
  expect(reviewPlan(input({ job: "securityfix" }), CFG, true).tier).toBe("standard");
  expect(reviewPlan(input({ job: "migrations" }), CFG, true).tier).toBe("standard");
});

test("every review schema default validates", () => {
  const d = defaults().review ?? {};
  const fields = SCHEMA.review?.fields ?? {};
  expect(Object.keys(fields)).toEqual(["enabled", "sensitive_paths", "light_paths", "light_lines", "light_reviewer", "deep_lines",
    "standard_reviewer", "deep_reviewer", "deep_inline", "deep_jobs"]);
  for (const key of Object.keys(fields)) expect(validate("review", key, d[key])).toBe(null);
  expect(d.light_reviewer).toBe("checker");
  expect(validate("review", "light_reviewer", "inline")).toBe(null);
  expect(validate("review", "light_reviewer", "sonnet")).not.toBe(null);
  expect(d.deep_reviewer).toBe("sonnet@high");
  expect(d.deep_inline).toBe(false);
  expect(validate("review", "deep_inline", "yes")).not.toBe(null);
  expect(d.standard_reviewer).toBe("sonnet@medium");
});
