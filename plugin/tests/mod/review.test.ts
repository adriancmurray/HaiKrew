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
  checker_skip_after: 15,
  checker_recheck_every: 5,
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

test("a run that changed only scratch files gets no review", () => {
  const scratch = reviewPlan(input({ paths: ["/var/folders/x/a.ts", "/Users/me/.claude/scratchpad/b.ts"] }), CFG, false);
  expect(scratch.tier).toBe("none");
  expect(scratch.reasons).toEqual(["changed only scratch files"]);
  expect(reviewPlan(input({ paths: ["/var/folders/x/a.ts", "src/mod/review.ts"] }), CFG, false).tier).not.toBe("none");
});

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

/** A docs-only light change of 20 lines, with a checker bucket of `checked` clean runs and `skipped` skipped runs. */
function light(checked: number, skipped: number, over: Partial<ReviewInput> = {}): ReviewInput {
  return input({ paths: ["docs/guide.md"], lines: 20, checkerBucket: { checked, skipped }, ...over });
}

const CHECKER = { model: "haiku", effort: "medium", agent: "haikrew:haiku-checker" };

test("the checker is skipped at exactly checker_skip_after clean runs, and the main model glances", () => {
  const plan = reviewPlan(light(15, 0), CFG, false);
  expect(plan.tier).toBe("light");
  expect(plan.reviewer).toBe(null);
  expect(plan.skipped).toBe(true);
  expect(plan.reasons).toEqual(["only light paths changed, 20 lines", "checker found nothing in 15 runs of this kind"]);
});

test("the checker still runs one clean run short of checker_skip_after, and the plan is not marked skipped", () => {
  const plan = reviewPlan(light(14, 0), CFG, false);
  expect(plan.reviewer).toEqual(CHECKER);
  expect(plan.reasons).toEqual(["only light paths changed, 20 lines"]);
  expect(plan.skipped).toBe(undefined);
});

test("a defect resets the clean count, so a kind with too few clean runs since keeps the checker", () => {
  const plan = reviewPlan(light(0, 0), CFG, false);
  expect(plan.reviewer).toEqual(CHECKER);
  expect(plan.reasons).toEqual(["only light paths changed, 20 lines"]);
});

test("checker_skip_after 0 never skips the checker", () => {
  const plan = reviewPlan(light(100, 0), { ...CFG, checker_skip_after: 0 }, false);
  expect(plan.reviewer).toEqual(CHECKER);
  expect(plan.reasons).toEqual(["only light paths changed, 20 lines"]);
});

test("without a checker bucket the checker is not skipped", () => {
  const plan = reviewPlan(input({ paths: ["docs/guide.md"], lines: 20 }), CFG, false);
  expect(plan.reviewer).toEqual(CHECKER);
  expect(plan.reasons).toEqual(["only light paths changed, 20 lines"]);
});

test("the inline light reviewer is unchanged by the skip: no reviewer, and no skip reason", () => {
  const plan = reviewPlan(light(20, 0), { ...CFG, light_reviewer: "inline" }, false);
  expect(plan.tier).toBe("light");
  expect(plan.reviewer).toBe(null);
  expect(plan.reasons).toEqual(["only light paths changed, 20 lines"]);
});

test("a skipped kind still skips while fewer than checker_recheck_every runs have been skipped", () => {
  const plan = reviewPlan(light(15, 3), CFG, false);
  expect(plan.reviewer).toBe(null);
  expect(plan.skipped).toBe(true);
  expect(plan.reasons).toEqual(["only light paths changed, 20 lines", "checker found nothing in 15 runs of this kind"]);
});

test("the fifth run of a skipped kind is checked again, with the skipped count as the reason", () => {
  const plan = reviewPlan(light(15, 4), CFG, false);
  expect(plan.reviewer).toEqual(CHECKER);
  expect(plan.skipped).toBe(undefined);
  expect(plan.reasons).toEqual(["only light paths changed, 20 lines", "checker re-run: 4 runs skipped since the last check"]);
});

test("checker_recheck_every 0 never re-checks a skipped kind", () => {
  const plan = reviewPlan(light(15, 100), { ...CFG, checker_recheck_every: 0 }, false);
  expect(plan.reviewer).toBe(null);
  expect(plan.skipped).toBe(true);
});

test("the skip does not apply to a standard review", () => {
  const plan = reviewPlan(input({ checkerBucket: { checked: 20, skipped: 0 } }), CFG, false);
  expect(plan.tier).toBe("standard");
  expect(plan.reviewer).toEqual({ model: "sonnet", effort: "medium" });
  expect(plan.reasons).toEqual(["changes outside the light paths"]);
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

test("a docs-only change is light at any size, checked by the haiku checker", () => {
  const plan = reviewPlan(input({ paths: ["README.md", "docs/guide/setup.mdx"], lines: 263 }), CFG, true);
  expect(plan.tier).toBe("light");
  expect(plan.reviewer).toEqual({ model: "haiku", effort: "medium", agent: "haikrew:haiku-checker" });
  expect(reviewPlan(input({ paths: ["docs/big.md"], lines: 500 }), CFG, true).tier).toBe("light");
  expect(reviewPlan(input({ paths: ["README.md", "CHANGELOG.md"], lines: 263 }), CFG, true).tier).toBe("light");
});

test("a 500-line agent instruction file is not light by the docs rule, so the size rule makes it deep", () => {
  const plan = reviewPlan(input({ paths: ["plugin/agents/x.md"], lines: 500 }), CFG, true);
  expect(plan.tier).toBe("deep");
  expect(plan.reasons).toEqual(["500 lines, at least 400"]);
});

test("requirements.txt is not documentation", () => {
  const plan = reviewPlan(input({ paths: ["requirements.txt"], lines: 263 }), CFG, false);
  expect(plan.tier).toBe("standard");
  expect(plan.reasons).toEqual(["changes outside the light paths"]);
});

test("a docs-only change that names a deep job stays deep", () => {
  const plan = reviewPlan(input({ job: "security", paths: ["README.md"], lines: 10 }), CFG, true);
  expect(plan.tier).toBe("deep");
});

test("docs plus one .ts file keeps the tier it had", () => {
  const plan = reviewPlan(input({ paths: ["README.md", "src/mod/review.ts"], lines: 263 }), CFG, false);
  expect(plan.tier).toBe("standard");
  expect(plan.reasons).toEqual(["changes outside the light paths"]);
});

test("an empty path list gets no review, whatever the lines", () => {
  expect(reviewPlan(input({ paths: [], lines: 263 }), CFG, false).tier).toBe("none");
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
  expect(Object.keys(fields)).toEqual(["enabled", "sensitive_paths", "light_paths", "light_lines", "light_reviewer",
    "checker_skip_after", "checker_recheck_every", "deep_lines", "standard_reviewer", "deep_reviewer", "deep_inline", "deep_jobs"]);
  for (const key of Object.keys(fields)) expect(validate("review", key, d[key])).toBe(null);
  expect(d.light_reviewer).toBe("checker");
  expect(validate("review", "light_reviewer", "inline")).toBe(null);
  expect(validate("review", "light_reviewer", "sonnet")).not.toBe(null);
  expect(d.checker_skip_after).toBe(15);
  expect(validate("review", "checker_skip_after", 0)).toBe(null);
  expect(validate("review", "checker_skip_after", -1)).not.toBe(null);
  expect(d.checker_recheck_every).toBe(5);
  expect(validate("review", "checker_recheck_every", 0)).toBe(null);
  expect(validate("review", "checker_recheck_every", -1)).not.toBe(null);
  expect(d.deep_reviewer).toBe("sonnet@high");
  expect(d.deep_inline).toBe(false);
  expect(validate("review", "deep_inline", "yes")).not.toBe(null);
  expect(d.standard_reviewer).toBe("sonnet@medium");
});
