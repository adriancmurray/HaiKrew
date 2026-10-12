/**
 * Argument dispatch for bin/haikrew.mjs. Each subcommand calls one module function.
 * Hooks, the ledger and the panel run inside the Claude Code mod (hooks/register.ts), not here.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { defaults, validate } from "./schema.ts";
import { listMarkdown, splitLines } from "./squeeze.ts";

const USAGE = "usage: haikrew squeeze [--max-lines N] [--wrap PREFIX] -- <cmd...> | verify | " +
  "patterns check [--dir PATH] [--max-files N] [--max-lines N]";
/** The `patterns check` caps when no flag overrides them. */
const PATTERNS_MAX_FILES = 20;
const PATTERNS_MAX_LINES = 40;

/** Dispatch argv to squeeze/verify/patterns. Resolves to the exit code. */
export async function main(argv: string[]): Promise<number> {
  if (argv.length === 0) return usage();
  const [cmd, ...rest] = argv;
  if (cmd === "squeeze") {
    const parsed = parseSqueezeArgs(rest);
    if (!parsed) return badArgs("squeeze");
    const { run } = await import("./squeeze.ts");
    return run(parsed.argv, { maxLines: parsed.maxLines, wrap: parsed.wrap });
  }
  if (cmd === "verify") {
    const { verify } = await import("./squeeze.ts");
    return verify(process.cwd());
  }
  if (cmd === "patterns" && rest[0] === "check") return patternsCheck(rest.slice(1));
  return usage();
}

/**
 * Count the pattern files in --dir (default ./patterns in the working directory) and their lines against the caps.
 * Exit 2 when the folder is missing or is not a directory, 1 on any violation, 0 otherwise.
 */
function patternsCheck(rest: string[]): number {
  const flags = parseFlags(rest, { dir: "patterns", "max-files": PATTERNS_MAX_FILES, "max-lines": PATTERNS_MAX_LINES });
  if (!flags) return badArgs("patterns check");
  const dir = resolve(process.cwd(), flags.dir as string);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    process.stderr.write(`patterns: no patterns folder at ${dir} (pass --dir)\n`);
    return 2;
  }
  const maxFiles = flags["max-files"] as number;
  const maxLines = flags["max-lines"] as number;
  const files = listMarkdown(dir);
  const problems: string[] = [];
  if (files.length > maxFiles) problems.push(`${files.length} pattern files, most allowed is ${maxFiles}`);
  for (const file of files) {
    const lines = splitLines(readFileSync(join(dir, file), "utf8")).length;
    if (lines > maxLines) problems.push(`${file}: ${lines} lines, most allowed is ${maxLines}`);
  }
  for (const problem of problems) process.stdout.write(`violation: ${problem}\n`);
  if (problems.length) return 1;
  process.stdout.write(`patterns ok: ${files.length} files within caps\n`);
  return 0;
}

/**
 * Parse squeeze's `--max-lines N` and `--wrap PREFIX` flags up to an optional `--`, then the command. Values are
 * checked against the schema. Null when a flag is unknown, a value is invalid, or no command follows.
 */
function parseSqueezeArgs(rest: string[]): { maxLines: number; wrap: string; argv: string[] } | null {
  let maxLines = defaults().squeeze.max_lines as number;
  let wrap = defaults().squeeze.wrap_prefix as string;
  let i = 0;
  while (i < rest.length && rest[i] !== "--") {
    const value = rest[i + 1];
    if (value === undefined) return null;
    if (rest[i] === "--max-lines") {
      if (!/^\d+$/.test(value) || validate("squeeze", "max_lines", Number(value)) !== null) return null;
      maxLines = Number(value);
    } else if (rest[i] === "--wrap") {
      wrap = value;
    } else {
      return null;
    }
    i += 2;
  }
  if (rest[i] === "--") i++;
  const argv = rest.slice(i);
  return argv.length === 0 ? null : { maxLines, wrap, argv };
}

/**
 * Parse `--name VALUE` or `--name=VALUE` flags over fallbacks. A number fallback takes a whole number, a text
 * fallback takes any non-empty text. Null when a flag is unknown, missing its value, or the value is bad.
 */
function parseFlags(rest: string[], fallbacks: Record<string, number | string>): Record<string, number | string> | null {
  const out = { ...fallbacks };
  for (let i = 0; i < rest.length; i++) {
    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(rest[i]);
    if (!match || !Object.hasOwn(out, match[1])) return null;
    const raw = match[2] ?? rest[++i];
    if (!raw) return null;
    if (typeof fallbacks[match[1]] === "number") {
      if (!/^-?\d+$/.test(raw)) return null;
      out[match[1]] = Number(raw);
    } else {
      out[match[1]] = raw;
    }
  }
  return out;
}

function badArgs(sub: string): number {
  process.stderr.write(`haikrew ${sub}: invalid arguments\n`);
  return 2;
}

function usage(): number {
  process.stderr.write(USAGE + "\n");
  return 2;
}
