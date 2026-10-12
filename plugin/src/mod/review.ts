/**
 * How a finished subagent's work gets checked: a pure decision from what the agent changed and its record.
 * No I/O, so the mod and the tests can both import it.
 */

/** What the decision sees about one finished agent: its tags, the files and lines it changed, its test result and record. */
export type ReviewInput = {
  job: string;
  lang: string;
  paths: string[];
  lines: number;
  testsPassed: boolean | null;
  model: string;
  record: { judged: number; passRate: number } | null;
};

/** The `review` section of the settings, as the decision reads it. */
export type ReviewSettings = {
  enabled: boolean;
  sensitive_paths: string[];
  light_paths: string[];
  light_lines: number;
  deep_lines: number;
  standard_reviewer: string;
  deep_reviewer: string;
  deep_jobs: string[];
};

/** How deep the check goes: none, light (the main agent glances at it), standard or deep. */
export type Tier = "none" | "light" | "standard" | "deep";

/** The chosen tier, the reviewer's model and effort (null when no subagent reviews) and the reasons for the choice. */
export type ReviewPlan = { tier: Tier; reviewer: { model: string; effort: string } | null; reasons: string[] };

// ponytail: only ** (any folders), * (one segment) and ? (one character); no braces or character classes, which the
// defaults do not need. Upgrade path: a glob library, if a setting ever needs braces.
/** True when the glob matches the whole path or a tail of it that starts after a "/", ignoring case. */
function pathGlob(glob: string, path: string): boolean {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob.charAt(i);
    if (glob.startsWith("**/", i)) {
      re += "(?:.*/)?";
      i += 2;
    } else if (glob.startsWith("**", i)) {
      re += ".*";
      i += 1;
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^(?:.*/)?${re}$`, "i").test(path);
}

/** The family name of a model id, capitalised: "claude-haiku-5-5" reads "Haiku". */
function modelName(model: string): string {
  const family = /haiku|sonnet|opus/i.exec(model)?.[0] ?? model;
  return family.charAt(0).toUpperCase() + family.slice(1).toLowerCase();
}

/** Why a change needs a deep review: its first sensitive path, a large diff, a deep job, failing tests or a poor record. */
function deepReasons(input: ReviewInput, cfg: ReviewSettings): string[] {
  const reasons: string[] = [];
  for (const path of input.paths) {
    const glob = cfg.sensitive_paths.find((g) => pathGlob(g, path));
    if (glob !== undefined) {
      reasons.push(`${path} matches sensitive path ${glob}`);
      break;
    }
  }
  if (input.lines >= cfg.deep_lines) reasons.push(`${input.lines} lines, at least ${cfg.deep_lines}`);
  if (cfg.deep_jobs.includes(input.job)) reasons.push(`job ${input.job} always gets a deep review`);
  if (input.testsPassed === false) reasons.push("tests failed");
  const r = input.record;
  if (r !== null && r.judged >= 4 && r.passRate < 0.6) {
    reasons.push(`${modelName(input.model)} passes ${Math.round(r.passRate * 100)}% of ${input.job}/${input.lang}`);
  }
  return reasons;
}

/** The reviewer for a "model@effort" setting. An Opus choice without the Opus allowance becomes Sonnet at high effort. */
function reviewerFor(spec: string, allowOpus: boolean, reasons: string[]): { model: string; effort: string } {
  const [model = "", effort = ""] = spec.split("@");
  if (model !== "opus" || allowOpus) return { model, effort };
  reasons.push("Opus not allowed");
  return { model: "sonnet", effort: "high" };
}

/**
 * The review tier, reviewer and reasons for one finished agent. Pure: the settings and the Opus allowance come in as values.
 * Order: disabled, then no files changed, then deep, then light, else standard.
 */
export function reviewPlan(input: ReviewInput, cfg: ReviewSettings, allowOpus: boolean): ReviewPlan {
  if (!cfg.enabled) return { tier: "none", reviewer: null, reasons: ["review is off"] };
  if (input.paths.length === 0) return { tier: "none", reviewer: null, reasons: ["changed no files"] };
  const deep = deepReasons(input, cfg);
  if (deep.length > 0) return { tier: "deep", reviewer: reviewerFor(cfg.deep_reviewer, allowOpus, deep), reasons: deep };
  const allLight = input.paths.every((p) => cfg.light_paths.some((g) => pathGlob(g, p)));
  if (allLight && input.lines < cfg.light_lines && input.testsPassed !== false) {
    return { tier: "light", reviewer: null, reasons: [`only light paths changed, ${input.lines} lines`] };
  }
  const reasons = [allLight ? `${input.lines} lines, at least ${cfg.light_lines}` : "changes outside the light paths"];
  return { tier: "standard", reviewer: reviewerFor(cfg.standard_reviewer, allowOpus, reasons), reasons };
}
