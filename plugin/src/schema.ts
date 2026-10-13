/**
 * HaiKrew settings schema: pure data and validation, no I/O, so both the mod (no Node APIs)
 * and the CLI can import it. settings.ts adds file storage on top.
 */
export type Value = boolean | number | string | string[];
/** `label` and `short` are for the pane only: a readable name and a one-line summary of `help`. */
export type Field = { label?: string; short?: string } & (
  | { type: "bool"; default: boolean; help: string }
  | { type: "int"; default: number; min: number; max: number; help: string }
  | { type: "num"; default: number; min: number; max: number; help: string }
  | { type: "str"; default: string; help: string; pattern?: string }
  | { type: "enum"; default: string; choices: string[]; help: string }
  | { type: "list"; default: string[]; help: string; pattern?: string });
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
      enabled: { label: "Gate on", type: "bool", default: false,
        help: "Turn the gate on. Off by default: until you turn it on, agent launches pass through unchanged." },
      delegate: { label: "Prefer the crew", type: "bool", default: true,
        help: "While the gate is on, ask Claude each session to hand spec-able work to haiku-coder and haiku-scout instead of doing it itself. " +
          "Adds a short note, built from these gate settings, to the CLAUDE.md text Claude reads." },
      default_model: { label: "Default model", type: "enum", choices: ["haiku", "sonnet", "opus"], default: "haiku",
        help: "Model given to an agent launched without one." },
      allow_opus: { label: "Allow Opus", type: "bool", default: false,
        help: "Allow subagents to run on Opus at all. Off: an Opus request is refused with a reason." },
      pinned_types: { label: "Pinned agent types", type: "list", default: ["haiku-coder"],
        help: "Agent types whose own definition sets the model; the gate leaves them alone." },
      allow_nested: { label: "Allow nested agents", type: "bool", default: true,
        help: "Let a subagent start agents of its own (Claude Code allows up to three levels by default)." },
      nested_model: { label: "Nested agent model", type: "enum", choices: ["haiku", "sonnet", "opus"], default: "haiku",
        help: "Model given to an agent that a subagent starts without naming one." },
      rules: { label: "Routing rules", type: "list", default: ["job:review=sonnet", "job:research=haiku", "type:Explore=haiku"],
        short: "First match wins, e.g. job:review=sonnet or lang:rust+job:implement=sonnet@high.",
        pattern: `^${TERM}(\\+${TERM})*=(haiku|sonnet|opus)(@${EFFORT})?$`,
        help: "Ordered rules, first match wins: selectors joined by +, then =haiku|sonnet|opus, optionally @low|medium|high|xhigh|max. " +
          "Selectors: job:<tag> and lang:<tag> (the HAIKREW job= and lang= tags on the prompt's first line), type:<agent type>, " +
          "desc:<words> (in the task description, ignoring case), cwd:<glob> (the session folder or a folder above it; ~ is your home)." },
      rules_override: { label: "Rules override caller", type: "bool", default: false,
        help: "Let rules replace a model the caller named." },
      default_effort: { label: "Default effort", type: "list", default: [], pattern: `^(haiku|sonnet|opus)=${EFFORT}$`,
        short: "Effort per model when no rule sets one, e.g. sonnet=high.",
        help: "Effort for subagents on a model when no rule sets one, e.g. sonnet=high. Empty: leave effort as it is. " +
          "Applies to subagents only, never to the main conversation." },
      instructions: { label: "Extra instructions", type: "list", default: [], pattern: `^${TERM_NOSPACE}(\\+${TERM_NOSPACE})*: .+$`,
        short: "Text added to matching subagent prompts, e.g. cwd:~/projects/*: never disable git hooks.",
        help: "Text added to the prompt of matching subagents, one entry each: <selectors>: <text>, " +
          "e.g. cwd:~/projects/*: never disable git hooks. Same selectors as rules. Empty: prompts are not changed." },
    },
  },
  decider: {
    title: "Decider",
    help: "Ask a SystemOne-compatible endpoint (the local Clefkit server, Jev or a proxy) which model, effort and review a launch should get. " +
      "Only launches with no named model and no matching rule are asked. Errors and timeouts leave the launch as the gate would have it.",
    fields: {
      mode: { label: "Mode", type: "enum", choices: ["off", "shadow", "decide"], default: "off",
        help: "Off: never asked. Shadow: asked and recorded in the ledger, but the launch is not changed. Decide: the confident answer is applied." },
      url: { label: "Endpoint", type: "str", default: "http://127.0.0.1:8790", pattern: "^https?://\\S+$",
        help: "Base URL of the server; HaiKrew posts to <url>/v1/systemone. The task text and a table of past results are sent there." },
      timeout_ms: { label: "Timeout (ms)", type: "int", default: 800, min: 100, max: 10000,
        help: "How long a launch waits for the answer before going ahead without it." },
      min_confidence: { label: "Minimum confidence", type: "num", default: 0.6, min: 0, max: 1,
        help: "A model or effort answer below this confidence is ignored." },
      explore_rate: { label: "Explore rate", type: "num", default: 0.1, min: 0, max: 1,
        help: "Chance that a pick above Haiku runs on the next cheaper model instead, when that model is plausible, so the ledger learns what it can do. Such runs get at least a standard review." },
    },
  },
  squeeze: {
    title: "Output squeeze",
    help: "Noisy shell commands are redirected through `haikrew squeeze`, which prints a short verdict and keeps the full log on disk.",
    fields: {
      enabled: { label: "Squeeze on", type: "bool", default: true, help: "Redirect matching commands." },
      patterns: { label: "Command patterns", type: "list", default: [
        "^(cargo) (test|build|check|clippy)\\b", "^swift (build|test)\\b", "^xcodebuild\\b",
        "^(pytest|python3? -m pytest)\\b", "^(npm|pnpm|yarn|bun) (run )?(test|build)\\b",
        "^go (test|build)\\b", "^make\\b"],
        help: "Regexes matched against the start of a Bash command." },
      max_lines: { label: "Summary lines", type: "int", default: 20, min: 5, max: 200, help: "Most lines a summary prints." },
      wrap_prefix: { label: "Wrapper command", type: "str", default: "",
        help: "Optional command prefixed to every squeezed run, e.g. a build lock wrapper." },
    },
  },
  read_guard: {
    title: "Large-file read guard",
    help: "A Read of a big file without a line range gets an outline instead, and is asked for a range.",
    fields: {
      enabled: { label: "Guard on", type: "bool", default: true, help: "Turn the guard on or off." },
      max_lines: { label: "Line limit", type: "int", default: 600, min: 100, max: 20000, help: "Files longer than this need an offset/limit." },
    },
  },
  checks: {
    title: "Checks",
    help: "Deterministic guards around agent work. No model calls.",
    fields: {
      guard_hooks: { label: "Git hook guard", type: "bool", default: true,
        help: "Refuse Bash commands that skip git hooks (--no-verify, core.hooksPath overrides), with a reason." },
      token_limits: { label: "Token warning per model", type: "list", default: ["haiku=800000", "sonnet=400000", "opus=200000"],
        pattern: "^(haiku|sonnet|opus)=[0-9]+$",
        short: "New-work tokens one subagent may use before HaiKrew warns, per model, e.g. haiku=800000.",
        help: "Warn when one subagent passes its model's limit: a toast, a mark in the crew, a ! above it. Tokens are new work: " +
          "input, cache writes and output; cache reads are not counted. A model left out, or 0, never warns. " +
          "An unknown model uses the lowest limit set." },
      token_effort_scale: { label: "Scale with effort", type: "bool", default: true,
        help: "Multiply each limit by the agent's effort: low ×0.5, medium ×1, high ×1.5, xhigh ×2, max ×3." },
      seam_check: { label: "Seam check prompt", type: "bool", default: false,
        short: "Also prompt for a full verify when parallel agents in one folder finish.",
        help: "When the last of 2+ parallel agents in one folder finishes, also send the main conversation a prompt to run " +
          "the full verify. Off: the reminder is only logged." },
    },
  },
  review: {
    title: "Review",
    help: "How each finished agent's work gets checked: HaiKrew picks a tier from what the agent changed and its record.",
    fields: {
      enabled: { label: "Review on", type: "bool", default: true,
        help: "Pick a review tier for each finished agent. Off: finished agents are not reviewed." },
      sensitive_paths: { label: "Sensitive paths", type: "list", default: [
        "**/hooks/**", "**/auth/**", "**/*auth*", "**/*secur*", "**/*crypt*", "**/migrations/**",
        "**/*.lock", "**/.github/**", "**/Package.swift", "**/Cargo.toml", "**/package.json"],
        help: "Path globs whose change always means a deep review." },
      light_paths: { label: "Light paths", type: "list", default: [
        "**/*.md", "**/docs/**", "**/tests/**", "**/*.test.*", "**/*.spec.*", "**/test_*"],
        help: "Path globs. Changes only to these can get a light review." },
      light_lines: { label: "Light below (lines)", type: "int", default: 60, min: 0, max: 100000,
        help: "Changes of fewer lines than this can get a light review, when they touch only light paths." },
      deep_lines: { label: "Deep from (lines)", type: "int", default: 400, min: 1, max: 1000000,
        help: "Changes of at least this many lines always get a deep review." },
      standard_reviewer: { label: "Standard reviewer", type: "enum", default: "sonnet@medium",
        choices: ["sonnet@low", "sonnet@medium", "sonnet@high", "haiku@high", "opus@medium"],
        help: "Model and effort of the reviewer for a standard review. An Opus choice needs Allow Opus." },
      deep_reviewer: { label: "Deep reviewer", type: "enum", default: "opus@high",
        choices: ["opus@high", "opus@medium", "opus@xhigh", "sonnet@high"],
        help: "Model and effort of the reviewer for a deep review. Without Allow Opus, Sonnet at high effort reviews instead. " +
          "When the main model is at least as strong, it reviews the risky hunks itself and no reviewer runs." },
      deep_jobs: { label: "Deep jobs", type: "list", default: ["security", "migration", "concurrency", "protocol"],
        pattern: "^[a-z0-9_-]+$",
        help: "Agent jobs (the HAIKREW job= tag) that always get a deep review. A longer job starting with one and a - or _ matches too: security covers security-review." },
    },
  },
  ledger: {
    title: "Agent ledger",
    help: "One row per finished subagent: model, job, language, time, tokens, verdict, quality.",
    fields: {
      enabled: { label: "Ledger on", type: "bool", default: true, help: "Record finished subagents." },
      raw_limit: { label: "Runs kept in full", type: "int", default: 200, min: 20, max: 5000,
        help: "Newest rows kept in full; older rows fold into monthly averages." },
      yearly_after_months: { label: "Months before yearly fold", type: "int", default: 12, min: 1, max: 120,
        help: "Monthly averages older than this fold into yearly ones." },
    },
  },
  agents: {
    title: "Agent control",
    help: "Let Claude and its agents use HaiKrew's tools: read status and the ledger, and, if allowed, change settings and rules. " +
      "Agents can never change this setting or turn on Allow Opus.",
    fields: {
      control: { label: "Agents may", type: "enum", choices: ["off", "read", "change"], default: "off",
        help: "Off: no HaiKrew tools for agents. Read: status, settings and ledger. Change: also settings and rules, each shown as a toast." },
    },
  },
  pane: {
    title: "The HaiKrew pane",
    help: "How this pane behaves. Like every setting here, it applies to all sessions.",
    fields: {
      open_on_start: { label: "Open on session start", type: "bool", default: false,
        help: "Open this pane by itself whenever a session starts. Off: open it with /haikrew." },
      time_style: { label: "Times", type: "enum", choices: ["relative", "clock", "both"], default: "relative",
        help: "How limit resets and past runs are shown: relative (in 2 h 14 min, 3 h ago), clock (at 6:00 PM, your time zone) or both." },
    },
  },
  band: {
    title: "Prompt widget",
    help: "The crew in the band above the prompt, in the desktop app: the main agent first, then each subagent at work.",
    fields: {
      show: { label: "Crew above the prompt", type: "bool", default: true,
        help: "Show the animated crew in the band above the prompt, whether or not this pane is open." },
      sky: { label: "Sky", type: "enum", choices: ["live", "dawn", "day", "dusk", "night"], default: "live",
        help: "The sky behind the crew: live follows your clock (sunrise, day, sunset, night with the real moon phase); " +
          "the others hold one time of day. The sun or moon at the right opens this pane." },
      scenery: { label: "Scenery", type: "enum", choices: ["mountains", "city", "forest", "hills"], default: "mountains",
        help: "The landscape behind the crew." },
      season: { label: "Season", type: "enum", choices: ["auto", "winter", "spring", "summer", "autumn", "none"], default: "auto",
        help: "Snow in winter and falling leaves in autumn. Auto picks the season by month; none draws neither." },
      clouds: { label: "Clouds", type: "bool", default: true, help: "Let a few pixel clouds drift across the sky." },
      headwear: { label: "Main agent wears", type: "enum", choices: ["crown", "wizard", "cap", "none"], default: "crown",
        help: "What the main agent (your conversation's own model) wears in the band." },
      haiku_color: { label: "Haiku colour", type: "str", default: "#9b7fc7", pattern: "^#[0-9a-fA-F]{6}$",
        help: "The colour of Haiku agents, as #rrggbb." },
      sonnet_color: { label: "Sonnet colour", type: "str", default: "#4f9c98", pattern: "^#[0-9a-fA-F]{6}$",
        help: "The colour of Sonnet agents, as #rrggbb." },
      opus_color: { label: "Opus colour", type: "str", default: "#d97757", pattern: "^#[0-9a-fA-F]{6}$",
        help: "The colour of Opus agents, as #rrggbb." },
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
    case "num":
      if (typeof value !== "number" || !Number.isFinite(value)) return "expected a number";
      return value >= f.min && value <= f.max ? null : `must be between ${f.min} and ${f.max}`;
    case "str":
      if (typeof value !== "string") return "expected text";
      return !f.pattern || new RegExp(f.pattern).test(value) ? null : `"${value}" does not match ${f.pattern}`;
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

