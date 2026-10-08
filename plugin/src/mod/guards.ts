/**
 * Tool guards, run on `tool.call`: a squeeze-pattern Bash command is denied with a pointer to
 * `haikrew squeeze`, a large text file read without a line range is denied with an outline, and a Bash
 * command that skips git hooks is denied.
 * Deny-and-redirect, never allow, so the user's permission rules still judge any redirected command.
 */
import type { Input, Next } from "./api.ts";

/** The `squeeze` section of settings. */
export type SqueezeSettings = { enabled: boolean; patterns: string[]; max_lines: number; wrap_prefix: string };
/** The `read_guard` section of settings. */
export type ReadGuardSettings = { enabled: boolean; max_lines: number };
/** The `checks` section of settings. */
export type ChecksSettings = { guard_hooks: boolean; seam_check: boolean };

// Leading `cd X &&` or `VAR=value ` segments, stripped repeatedly before pattern matching.
const LEAD = /^\s*(?:cd\s+\S+\s*&&\s*|[A-Za-z_]\w*=\S*\s+)/;
// A command that already runs through haikrew squeeze, bare or via python3/node on the bin path.
const ALREADY = /^(?:(?:python3?|node)\s+)?["']?\S*haikrew(?:\.mjs)?["']?\s+squeeze\b/;
const DEF = /^\s*(?:(?:pub|async|export|static|default)\s+)*(?:def|class|fn|func|struct|impl|enum|interface|type|export)\b|^#{1,6}\s/;
const OUTLINE_MAX = 60;
// A git invocation that skips hooks: --no-verify as its own word, or core.hooksPath set by -c or config.
const HOOK_BYPASS = /(^|\s)--no-verify(\s|$)|core\.hooksPath=|-c\s+core\.hooksPath\b/;

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
  if (!cfg.guard_hooks || !HOOK_BYPASS.test(String(e.command))) return next(e);
  return {
    deny: "HaiKrew refuses commands that skip git hooks (--no-verify, core.hooksPath). Fix what the hook reports " +
      "and run the command without the bypass, or turn off checks.guard_hooks in /haikrew settings.",
  };
}

/**
 * Read: a text file over max_lines read without offset/limit is denied, with its line count and an outline
 * of definition lines so the caller can ask for a ranged read. `text` is the file's content, or null when it
 * could not be read; unreadable or binary files pass through.
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
      "pass offset and limit (for example offset=1, limit=200), choosing from this outline:\n" +
      outline.slice(0, OUTLINE_MAX).join("\n"),
  };
}

/** Lines of text, a trailing newline not counting as an extra line. */
export function splitLines(text: string): string[] {
  const lines = text.split(/\r\n|\r|\n/);
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** The command with leading `cd X &&` and env-assignment segments removed. */
function stripLead(command: string): string {
  let prev: string | null = null;
  while (prev !== command) {
    prev = command;
    command = command.replace(LEAD, "");
  }
  return command.trim();
}
