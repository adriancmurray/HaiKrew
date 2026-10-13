/**
 * Tool guards, run on `tool.call`: a squeeze-pattern Bash command is denied with a pointer to
 * `haikrew squeeze`, a large text file read without a line range is denied with an outline, and a Bash
 * command that skips git hooks is denied.
 * Deny-and-redirect, never allow, so the user's permission rules still judge any redirected command.
 */
import { isObject } from "./api.ts";
import type { Input, Next } from "./api.ts";
import { modelFamily, rowFor } from "./crew.ts";
import { DYNAMIC_WRITE, REPO_WRITE, shellWrites } from "./shell-writes.ts";

/** The `guards` section of settings. */
export type GuardsSettings = { read_only_agents: boolean };
/** The `squeeze` section of settings. */
export type SqueezeSettings = { enabled: boolean; patterns: string[]; max_lines: number; wrap_prefix: string };
/** The `read_guard` section of settings. */
export type ReadGuardSettings = { enabled: boolean; max_lines: number };
/** The `checks` section of settings. */
export type ChecksSettings = { guard_hooks: boolean; seam_check: boolean; token_limits: string[]; token_effort_scale: boolean };

// Leading `cd X &&` or variable assignments such as `A=1 `, stripped repeatedly before pattern matching.
const LEAD = /^\s*(?:cd\s+\S+\s*&&\s*|[A-Za-z_]\w*=\S*\s+)/;
// A command that already runs through haikrew squeeze, bare or via python3/node on the bin path.
const ALREADY = /^(?:(?:python3?|node)\s+)?["']?\S*haikrew(?:\.mjs)?["']?\s+squeeze\b/;
const DEF = /^\s*(?:(?:pub|async|ex[p]ort|static|default)\s+)*(?:def|class|fn|func|struct|impl|enum|interface|type|ex[p]ort)\b|^#+\s/;
// [p] keeps the directory scan from reading the keyword as a shell command; ^#+\s is a Markdown heading.
const OUTLINE_MAX = 60;
// A git invocation that skips hooks: --no-verify as its own word, or core.hooksPath given with -c or git config.
const HOOK_SKIP = /(^|\s)--no-verify(\s|$)|core\.hooksPath=|-c\s+core\.hooksPath\b/;
// One `token_limits` entry: a model family and its limit in new-work tokens.
const LIMIT = /^(haiku|sonnet|opus)=(\d+)$/;
// The multiplier on a limit for each effort when token_effort_scale is on; an effort not listed, or none, counts as x1.
const EFFORT_SCALE = new Map([["low", 0.5], ["medium", 1], ["high", 1.5], ["xhigh", 2], ["max", 3]]);

/**
 * Bash: deny a squeeze-pattern command and name `node "<root>/bin/haikrew.mjs" squeeze --max-lines <n> [--wrap "<prefix>"] -- <command>`.
 */
export function squeeze(cfg: SqueezeSettings, e: Input, root: string, next: Next): unknown {
  const command = String(e.command || "");
  const core = stripLead(command);
  if (!cfg.enabled || ALREADY.test(core) || !cfg.patterns.some((p) => new RegExp(`^(?:${p})`).test(core))) {
    return next(e);
  }
  const wrap = cfg.wrap_prefix ? ` --wrap "${cfg.wrap_prefix}"` : "";
  return {
    deny: `Run it through squeeze instead: node "${root}/bin/haikrew.mjs" squeeze --max-lines ${cfg.max_lines}${wrap} -- ${command}`,
  };
}

/**
 * Bash: deny a command that skips git hooks, with the way out: fix the hook's report, or turn the guard off.
 */
export function hookGuard(cfg: ChecksSettings, e: Input, next: Next): unknown {
  if (!cfg.guard_hooks || !HOOK_SKIP.test(String(e.command))) return next(e);
  return {
    deny: "HaiKrew refuses commands that skip git hooks (--no-verify, core.hooksPath). Fix what the hook reports " +
      "and run the command without skipping hooks, or turn off checks.guard_hooks in /haikrew settings.",
  };
}

// Subagent types that review or search and never write: their Bash writes stay in scratch space.
const READ_ONLY_TYPES = new Set(["haikrew:haiku-checker", "haikrew:sonnet-reviewer", "Explore"]);

/** Whether a subagent type is read-only (checker, reviewer, Explore). Such an agent claims no files. */
export function isReadOnlyType(type: string): boolean {
  return READ_ONLY_TYPES.has(type);
}
// Scratch space: the macOS and Linux temp folders. ponytail: the mod sandbox has no os.tmpdir(), so a custom TMPDIR
// is not seen; the upgrade path is passing the real temp folder in from the plugin root.
const TEMP = /^(?:\/tmp|\/private\/tmp|\/var\/folders|\/private\/var\/folders)(?:\/|$)/;

/**
 * The type of a subagent: its crew row's when the row knows it, else the live agent list's, since a foreground agent's
 * row gets its type only after its Agent call returns. "" when neither knows it or the list cannot be read.
 */
export async function callerType(list: () => Promise<unknown>, id: string): Promise<string> {
  const known = rowFor(id, Date.now())?.type;
  if (known && known !== "agent") return known;
  try {
    const agents = await list();
    const live = Array.isArray(agents) ? agents.find((a) => isObject(a) && a.id === id) : undefined;
    return isObject(live) && typeof live.type === "string" ? live.type : "";
  } catch {
    return "";
  }
}

/** Folds `path` against `dir` into a clean path (`.` and `..` resolved); a relative path stays relative when `dir` is "". */
export function resolvePath(dir: string, path: string): string {
  const abs = path.startsWith("/");
  const out: string[] = [];
  for (const seg of (abs ? path : `${dir}/${path}`).split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return (abs || dir.startsWith("/") ? "/" : "") + out.join("/");
}

// A leading `cd <dir> &&` or `cd <dir>;`, one per match.
const LEAD_CD = /^\s*cd\s+("[^"]*"|'[^']*'|[^\s;&|]+)\s*(?:&&|;)\s*/;

/** The directory a Bash command runs in: `cwd`, moved by each leading `cd <dir>`. */
export function commandDir(command: string, cwd: string): string {
  let dir = cwd;
  let rest = command;
  let m = LEAD_CD.exec(rest);
  while (m) {
    dir = resolvePath(dir, (m[1] ?? "").replace(/^["']|["']$/g, ""));
    rest = rest.slice(m[0].length);
    m = LEAD_CD.exec(rest);
  }
  return dir;
}

/**
 * Bash: deny a write by a read-only subagent (checker, reviewer, Explore) to a path outside the temp folders and a
 * scratchpad. Relative targets resolve from the command's directory (`cwd`, moved by a leading `cd`). A target with
 * `$` or a backtick cannot be resolved, so it is denied too. `type` is the caller's subagent type; the main loop
 * passes "" and is never denied.
 */
export function readOnlyGuard(cfg: GuardsSettings, type: string, e: Input, cwd: string, next: Next): unknown {
  if (!cfg.read_only_agents || !READ_ONLY_TYPES.has(type)) return next(e);
  const command = String(e.command || "");
  const dir = commandDir(command, cwd);
  for (const target of shellWrites(command) ?? []) {
    if (target === DYNAMIC_WRITE) return { deny: `${type} is read-only: write target not literal; use a literal temp path` };
    const path = target === REPO_WRITE ? dir : resolvePath(dir, target);
    if (TEMP.test(path) || path.includes("/scratchpad/")) continue;
    const shown = target === REPO_WRITE ? `<repo> at ${path}` : path;
    return { deny: `${type} is read-only: write to ${shown} refused; use a temp folder` };
  }
  return next(e);
}

/**
 * The new-work tokens one subagent may use before its token warning, for its model and effort. A model with no
 * entry, or a limit of 0, never warns (0). An unknown model takes the smallest positive limit, so an unfamiliar
 * model is still watched. With token_effort_scale on, the limit is multiplied by the effort and rounded.
 */
export function tokenLimit(checks: Pick<ChecksSettings, "token_limits" | "token_effort_scale">, model: string, effort?: string): number {
  const limits = new Map<string, number>();
  for (const entry of checks.token_limits) {
    const m = LIMIT.exec(entry);
    if (m) limits.set(m[1] ?? "", Number(m[2]));
  }
  const family = modelFamily(model);
  let base = limits.get(family) ?? 0;
  if (family === "unknown") {
    const positive = [...limits.values()].filter((n) => n > 0);
    base = positive.length ? Math.min(...positive) : 0;
  }
  if (base <= 0 || !checks.token_effort_scale) return base;
  return Math.round(base * (EFFORT_SCALE.get(effort ?? "") ?? 1));
}

/**
 * Read: a text file over max_lines read without offset/limit is denied, with its line count and an outline
 * of definition lines so the caller can ask for a ranged read. `text` is the file's content, or null when it
 * could not be read; unreadable or binary files go on unchanged.
 */
export function readGuard(cfg: ReadGuardSettings, e: Input, text: string | null, next: Next): unknown {
  if (!cfg.enabled || e.offset != null || e.limit != null || text === null) return next(e);
  const file = String(e.file_path || "");
  if (text.includes("\u0000")) return next(e);
  const lines = splitLines(text);
  if (lines.length <= cfg.max_lines) return next(e);
  const outline = lines.flatMap((line, i) =>
    DEF.test(line) ? [`${i + 1}: ${[...line.trim()].slice(0, 120).join("")}`] : []);
  return {
    deny: `${file} is ${lines.length} lines, over the ${cfg.max_lines}-line limit. Read it with a range: ` +
      "give offset and limit (for example offset=1, limit=200), choosing from this outline:\n" +
      outline.slice(0, OUTLINE_MAX).join("\n"),
  };
}

/** Lines of text, a trailing newline not counting as an extra line. */
export function splitLines(text: string): string[] {
  const lines = text.split(/\r\n|\r|\n/);
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** The command with leading `cd X &&` and variable assignments removed. */
function stripLead(command: string): string {
  let prev: string | null = null;
  while (prev !== command) {
    prev = command;
    command = command.replace(LEAD, "");
  }
  return command.trim();
}
