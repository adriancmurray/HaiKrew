/**
 * Argument dispatch for bin/haikrew.mjs. Each subcommand calls one module function.
 * Hooks, the ledger and the panel run inside the Claude Code mod (hooks/register.ts), not here.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { get } from "./settings.ts";
import { listMarkdown, splitLines } from "./squeeze.ts";

const USAGE = "usage: haikrew squeeze -- <cmd...> | verify | stats [--days N] | patterns check";
const PATTERNS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "patterns");

/** Dispatch argv to squeeze/verify/stats/patterns. Resolves to the exit code. */
export async function main(argv: string[]): Promise<number> {
  if (argv.length === 0) return usage();
  const [cmd, ...rest] = argv;
  if (cmd === "squeeze") {
    const args = rest[0] === "--" ? rest.slice(1) : rest;
    if (args.length === 0) return usage();
    const { run } = await import("./squeeze.ts");
    return run(args);
  }
  if (cmd === "verify") {
    const { verify } = await import("./squeeze.ts");
    return verify(process.cwd());
  }
  if (cmd === "stats") return stats(rest);
  if (cmd === "patterns" && rest.length === 1 && rest[0] === "check") return patternsCheck();
  return usage();
}

/** Token use per model over the last N days (default 7), printed as JSON. */
async function stats(rest: string[]): Promise<number> {
  const flags = parseIntFlags(rest, { days: 7 });
  if (!flags) return badArgs("stats");
  const { totals } = await import("./stats.ts");
  process.stdout.write(JSON.stringify(await totals(flags.days), null, 2) + "\n");
  return 0;
}

/** Count the pattern files and their lines against patterns.* caps. Exit 1 on any violation. */
function patternsCheck(): number {
  const maxFiles = get<number>("patterns", "max_files");
  const maxLines = get<number>("patterns", "max_lines");
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

/** Parse `--name N` or `--name=N` integer flags over defaults. Null when a flag is unknown or not an integer. */
function parseIntFlags(rest: string[], defaults: Record<string, number>): Record<string, number> | null {
  const out = { ...defaults };
  for (let i = 0; i < rest.length; i++) {
    const match = /^--([a-z]+)(?:=(.*))?$/.exec(rest[i]);
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
