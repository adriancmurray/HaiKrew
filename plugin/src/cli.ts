/**
 * Argument dispatch for bin/haikrew.mjs. Each subcommand calls one module function.
 * Hooks, the ledger and the panel run inside the Claude Code mod (hooks/register.ts), not here.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defaults, validate } from "./schema.ts";
import { listMarkdown, splitLines } from "./squeeze.ts";

const USAGE = "usage: haikrew squeeze [--max-lines N] [--wrap PREFIX] -- <cmd...> | verify | " +
  "patterns check [--max-files N] [--max-lines N]";
const PATTERNS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "patterns");

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

/** Count the pattern files and their lines against the caps (schema defaults, or the flags). Exit 1 on any violation. */
function patternsCheck(rest: string[]): number {
  const flags = parseIntFlags(rest, { "max-files": defaults().patterns.max_files as number,
    "max-lines": defaults().patterns.max_lines as number });
  if (!flags) return badArgs("patterns check");
  const maxFiles = flags["max-files"];
  const maxLines = flags["max-lines"];
  const files = listMarkdown(PATTERNS_DIR);
  const problems: string[] = [];
  if (files.length > maxFiles) problems.push(`${files.length} pattern files, most allowed is ${maxFiles}`);
  for (const file of files) {
    const lines = splitLines(readFileSync(join(PATTERNS_DIR, file), "utf8")).length;
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

/** Parse `--name N` or `--name=N` integer flags over defaults. Null when a flag is unknown or not an integer. */
function parseIntFlags(rest: string[], defaults: Record<string, number>): Record<string, number> | null {
  const out = { ...defaults };
  for (let i = 0; i < rest.length; i++) {
    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(rest[i]);
    if (!match || !Object.hasOwn(out, match[1])) return null;
    const raw = match[2] ?? rest[++i];
    if (raw === undefined || !/^-?\d+$/.test(raw)) return null;
    out[match[1]] = Number(raw);
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
