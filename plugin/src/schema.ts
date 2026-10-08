/**
 * HaiKrew settings schema: pure data and validation, no I/O, so both the mod (no Node APIs)
 * and the CLI can import it. settings.ts adds file storage on top.
 */
export type Value = boolean | number | string | string[];
export type Field =
  | { type: "bool"; default: boolean; help: string }
  | { type: "int"; default: number; min: number; max: number; help: string }
  | { type: "str"; default: string; help: string }
  | { type: "enum"; default: string; choices: string[]; help: string }
  | { type: "list"; default: string[]; help: string; pattern?: string; sep?: string };
export type Section = { title: string; help: string; fields: Record<string, Field> };
export type Settings = Record<string, Record<string, Value>>;

/** One selector term: job:<tag>, type:<agent type>, desc:<words>, lang:<tag> or cwd:<glob>. Terms join with "+". */
const TERM = "(job|type|desc|lang|cwd):[^=+]+";
const TERM_NOSPACE = "(job|type|desc|lang|cwd):[^\\s+]+";
const EFFORT = "(low|medium|high|xhigh|max)";

export const SCHEMA: Record<string, Section> = {
  gate: {
    title: "Agent model gate",
    help: "Applies to every subagent launch (the Agent tool).",
    fields: {
      enabled: { type: "bool", default: false,
        help: "Turn the gate on. Off by default: until you turn it on, agent launches pass through unchanged." },
      default_model: { type: "enum", choices: ["haiku", "sonnet", "opus"], default: "haiku",
        help: "Model given to an agent launched without one." },
      allow_opus: { type: "bool", default: false,
        help: "Allow subagents to run on Opus at all. Off: an Opus request is refused with a reason." },
      pinned_types: { type: "list", default: ["haiku-coder"],
        help: "Agent types whose own definition sets the model; the gate leaves them alone." },
      allow_nested: { type: "bool", default: true,
        help: "Let a subagent start agents of its own (Claude Code allows up to three levels by default)." },
      nested_model: { type: "enum", choices: ["haiku", "sonnet", "opus"], default: "haiku",
        help: "Model given to an agent that a subagent starts without naming one." },
      rules: { type: "list", default: ["job:review=sonnet", "job:research=haiku", "type:Explore=haiku"],
        pattern: `^${TERM}(\\+${TERM})*=(haiku|sonnet|opus)(@${EFFORT})?$`,
        help: "Ordered rules, first match wins: selectors joined by +, then =haiku|sonnet|opus, optionally @low|medium|high|xhigh|max. " +
          "Selectors: job:<tag> and lang:<tag> (the HAIKREW job= and lang= tags on the prompt's first line), type:<agent type>, " +
          "desc:<words> (in the task description, ignoring case), cwd:<glob> (the session folder or a folder above it; ~ is your home)." },
      rules_override: { type: "bool", default: false,
        help: "Let rules replace a model the caller named." },
      default_effort: { type: "list", default: [], pattern: `^(haiku|sonnet|opus)=${EFFORT}$`,
        help: "Effort for subagents on a model when no rule sets one, e.g. sonnet=high. Empty: leave effort as it is. " +
          "Applies to subagents only, never to the main conversation." },
      instructions: { type: "list", default: [], sep: "|", pattern: `^${TERM_NOSPACE}(\\+${TERM_NOSPACE})*: .+$`,
        help: "Text added to the prompt of matching subagents, entries separated by |: <selectors>: <text>, " +
          "e.g. cwd:~/projects/*: never disable git hooks. Same selectors as rules. Empty: prompts are not changed." },
    },
  },
  squeeze: {
    title: "Output squeeze",
    help: "Noisy shell commands are redirected through `haikrew squeeze`, which prints a short verdict and keeps the full log on disk.",
    fields: {
      enabled: { type: "bool", default: true, help: "Redirect matching commands." },
      patterns: { type: "list", default: [
        "^(cargo) (test|build|check|clippy)\\b", "^swift (build|test)\\b", "^xcodebuild\\b",
        "^(pytest|python3? -m pytest)\\b", "^(npm|pnpm|yarn|bun) (run )?(test|build)\\b",
        "^go (test|build)\\b", "^make\\b"],
        help: "Regexes matched against the start of a Bash command." },
      max_lines: { type: "int", default: 20, min: 5, max: 200, help: "Most lines a summary prints." },
      wrap_prefix: { type: "str", default: "",
        help: "Optional command prefixed to every squeezed run, e.g. a build lock wrapper." },
    },
  },
  read_guard: {
    title: "Large-file read guard",
    help: "A Read of a big file without a line range gets an outline instead, and is asked for a range.",
    fields: {
      enabled: { type: "bool", default: true, help: "Turn the guard on or off." },
      max_lines: { type: "int", default: 600, min: 100, max: 20000, help: "Files longer than this need an offset/limit." },
    },
  },
  checks: {
    title: "Checks",
    help: "Deterministic guards around agent work. No model calls.",
    fields: {
      guard_hooks: { type: "bool", default: true,
        help: "Refuse Bash commands that skip git hooks (--no-verify, core.hooksPath overrides), with a reason." },
      seam_check: { type: "bool", default: false,
        help: "When the last of 2+ parallel agents in one folder finishes, also send the main conversation a prompt to run " +
          "the full verify. Off: the reminder is only logged." },
    },
  },
  ledger: {
    title: "Agent ledger",
    help: "One row per finished subagent: model, job, language, time, tokens, verdict, quality.",
    fields: {
      enabled: { type: "bool", default: true, help: "Record finished subagents." },
      raw_limit: { type: "int", default: 200, min: 20, max: 5000,
        help: "Newest rows kept in full; older rows fold into monthly averages." },
      yearly_after_months: { type: "int", default: 12, min: 1, max: 120,
        help: "Monthly averages older than this fold into yearly ones." },
    },
  },
  patterns: {
    title: "Patterns",
    help: "Short reusable implementation patterns agents read. Capped so they stay lean.",
    fields: {
      max_files: { type: "int", default: 20, min: 1, max: 200, help: "Most pattern files allowed." },
      max_lines: { type: "int", default: 40, min: 5, max: 400, help: "Most lines per pattern file." },
    },
  },
};

/** Every section and field at its schema default. */
export function defaults(): Settings {
  const out: Settings = {};
  for (const [s, sec] of Object.entries(SCHEMA)) {
    out[s] = {};
    for (const [k, f] of Object.entries(sec.fields)) out[s][k] = JSON.parse(JSON.stringify(f.default));
  }
  return out;
}

/** An error message if `value` is not valid for section.key, else null. */
export function validate(section: string, key: string, value: unknown): string | null {
  const f = SCHEMA[section]?.fields[key];
  if (!f) return `unknown setting ${section}.${key}`;
  switch (f.type) {
    case "bool": return typeof value === "boolean" ? null : "expected true or false";
    case "int":
      if (typeof value !== "number" || !Number.isInteger(value)) return "expected a whole number";
      return value >= f.min && value <= f.max ? null : `must be between ${f.min} and ${f.max}`;
    case "str": return typeof value === "string" ? null : "expected text";
    case "enum": return f.choices.includes(value as string) ? null : `must be one of ${f.choices.join(", ")}`;
    case "list": {
      if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) return "expected a list of text values";
      if (!f.pattern) return null;
      const pattern = new RegExp(f.pattern);
      const bad = value.find((v) => !pattern.test(v));
      return bad === undefined ? null : `entry "${bad}" does not match ${f.pattern}`;
    }
  }
}

