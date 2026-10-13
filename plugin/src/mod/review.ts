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
  /** The decider had the agent run a cheaper model than its pick, to learn what that model can do. */
  explored?: boolean;
  /** The model of the main conversation. With `deep_inline` on, a deep review stays with it when it is at least as strong as the deep reviewer. */
  mainModel?: string;
};

/** The `review` section of the settings, as the decision reads it. */
export type ReviewSettings = {
  enabled: boolean;
  sensitive_paths: string[];
  light_paths: string[];
  light_lines: number;
  /** "checker" (a Haiku checker agent) or "inline" (the main agent glances at the diff). */
  light_reviewer: string;
  deep_lines: number;
  standard_reviewer: string;
  deep_reviewer: string;
  /** Whether the main model reviews a deep change itself when it is at least as strong as the deep reviewer. */
  deep_inline: boolean;
  deep_jobs: string[];
};

/** How deep the check goes: none, light (a checker agent, or the main agent's glance), standard or deep. */
export type Tier = "none" | "light" | "standard" | "deep";

/** The agent type that checks a light change when `light_reviewer` is "checker". */
export const CHECKER_AGENT = "haikrew:haiku-checker";

/**
 * The chosen tier, the reviewer's model and effort, "inline" when the main model reviews the risky hunks itself,
 * null when nothing reviews, and the reasons for the choice. `agent` names the agent type that reviews, when one does.
 */
export type ReviewPlan = {
  tier: Tier;
  reviewer: { model: string; effort: string; agent?: string } | "inline" | null;
  reasons: string[];
};

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

/** The family of a model id, lower case: "haiku", "sonnet" or "opus" in any case, else undefined. */
function family(model: string): string | undefined {
  return /haiku|sonnet|opus/i.exec(model)?.[0]?.toLowerCase();
}

/** The family name of a model id, capitalised: "claude-haiku-5-5" reads "Haiku". */
function modelName(model: string): string {
  const name = family(model) ?? model;
  return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
}

const RANKS = ["haiku", "sonnet", "opus"];

/** How strong a model id is: haiku 0, sonnet 1, opus 2; -1 when the id names none of them. */
function rank(model: string | undefined): number {
  const f = family(model ?? "");
  return f === undefined ? -1 : RANKS.indexOf(f);
}

/** True when the job is a listed one, or a longer name that starts with it and a "-" or "_": "security" covers "security-review". */
function deepJob(job: string, listed: string[]): boolean {
  return listed.some((j) => job === j || job.startsWith(`${j}-`) || job.startsWith(`${j}_`));
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
  if (deepJob(input.job, cfg.deep_jobs)) reasons.push(`job ${input.job} always gets a deep review`);
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
 * A deep plan. With `deep_inline` on, the main model reviews inline when it is known and at least as strong as the reviewer
 * that would run, so no fresh reviewer re-derives context the main model already has. Otherwise the deep reviewer runs:
 * the main thread then never re-reads its own long context to review.
 */
function deepPlan(input: ReviewInput, cfg: ReviewSettings, allowOpus: boolean, deep: string[]): ReviewPlan {
  const reasons = [...deep];
  const reviewer = reviewerFor(cfg.deep_reviewer, allowOpus, reasons);
  const main = rank(input.mainModel);
  const r = rank(reviewer.model);
  if (cfg.deep_inline && main >= 0 && r >= 0 && main >= r) {
    const why = `reviewed inline: ${modelName(input.mainModel ?? "")} is at least as strong as ${modelName(reviewer.model)}`;
    return { tier: "deep", reviewer: "inline", reasons: [...deep, why] };
  }
  return { tier: "deep", reviewer, reasons };
}

/**
 * The review tier, reviewer and reasons for one finished agent. Pure: the settings and the Opus allowance come in as values.
 * Order: disabled, then no files changed, then deep, then light, else standard.
 */
export function reviewPlan(input: ReviewInput, cfg: ReviewSettings, allowOpus: boolean): ReviewPlan {
  if (!cfg.enabled) return { tier: "none", reviewer: null, reasons: ["review is off"] };
  if (input.paths.length === 0) return { tier: "none", reviewer: null, reasons: ["changed no files"] };
  const deep = deepReasons(input, cfg);
  if (deep.length > 0) return deepPlan(input, cfg, allowOpus, deep);
  const allLight = input.paths.every((p) => cfg.light_paths.some((g) => pathGlob(g, p)));
  // An explored run is checked properly: a light glance would not tell whether the cheaper model did well.
  if (allLight && input.lines < cfg.light_lines && input.testsPassed !== false && !input.explored) {
    const reasons = [`only light paths changed, ${input.lines} lines`];
    const reviewer = cfg.light_reviewer === "checker" ? { model: "haiku", effort: "medium", agent: CHECKER_AGENT } : null;
    return { tier: "light", reviewer, reasons };
  }
  const reasons: string[] = [];
  if (!allLight) reasons.push("changes outside the light paths");
  else if (input.lines >= cfg.light_lines) reasons.push(`${input.lines} lines, at least ${cfg.light_lines}`);
  if (input.explored) reasons.push("explored: a cheaper model than the decider's pick");
  return { tier: "standard", reviewer: reviewerFor(cfg.standard_reviewer, allowOpus, reasons), reasons };
}
