/**
 * Run a command and print a short verdict instead of its full output.
 * Output is captured, the full log goes to DATA/logs, and at most maxLines lines are printed.
 */
import { spawnSync } from "node:child_process";
import { accessSync, constants, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { defaults } from "./schema.ts";

/** Where full logs go. */
const DATA = join(homedir(), ".local", "share", "haikrew");
const SQUEEZE_DEFAULTS = defaults().squeeze;

/** How one squeezed run is printed and launched. Defaults come from the schema when the CLI gets no flags. */
export type SqueezeOptions = { maxLines: number; wrap: string; cwd?: string };
/** Options with the schema defaults for squeeze.max_lines and squeeze.wrap_prefix. */
export const SQUEEZE_OPTIONS: SqueezeOptions = {
  maxLines: SQUEEZE_DEFAULTS.max_lines as number,
  wrap: SQUEEZE_DEFAULTS.wrap_prefix as string,
};

const ERR_LIMIT = 8;
const CARGO_ERR_LIMIT = 5;
const GENERIC_TAIL = 5;
const JEST_WORDS = new Set(["npm", "pnpm", "yarn", "bun", "npx", "jest", "vitest"]);
const CARGO_RESULT = /^test result: \w+\. (\d+) passed; (\d+) failed/;
const CARGO_TEST_FAILED = /^test (\S+) \.\.\. FAILED$/;
const CARGO_ERR = /^error(\[\w+\])?: /;
const SWIFT_RUN = /Test run with \d+ tests?/;
const SWIFT_ERR = /^\S+\.swift:\d+:\d+: error: /;
const PYTEST_COUNT = /\d+ (passed|failed|error)/;
const JEST_LINE = /^(?:Tests:?\s+\S|FAIL\b)/;
const GO_LINE = /^(?:\s*--- FAIL: |(?:ok|FAIL)\s+\S+)/;
const GENERIC_ERR = /error|fail|panic|exception/i;

type Summarizer = (log: string) => string[];

/** Lines of text as Python's str.splitlines() yields them: a trailing newline adds no empty line. */
export function splitLines(text: string): string[] {
  const lines = text.split(/\r\n|\r|\n/);
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/**
 * Run argv (prefixed by opts.wrap if set) with output captured, write the log, and print
 * `squeeze: <cmd> -> exit <code> in <seconds>s (log: <path>)`, a summary, then a VERDICT line.
 * Returns the command's exit code.
 */
export function run(argv: string[], opts: SqueezeOptions = SQUEEZE_OPTIONS): number {
  const maxLines = opts.maxLines;
  const cmd = [...shellSplit(opts.wrap), ...argv];
  const started = performance.now();
  const proc = spawnSync(cmd[0], cmd.slice(1), { cwd: opts.cwd, encoding: "utf8", stdio: ["inherit", "pipe", "pipe"] });
  const elapsed = (performance.now() - started) / 1000;
  let code: number;
  let output: string;
  if (proc.error) {
    code = 127;
    output = `${proc.error.message}\n`;
  } else {
    code = proc.status ?? 1;
    output = `${proc.stdout ?? ""}${proc.stderr ?? ""}`;
  }
  const log = writeLog(argv, output);
  const body = summarize(argv.join(" "), output).slice(0, maxLines - 2);
  const head = `squeeze: ${argv.join(" ")} -> exit ${code} in ${elapsed.toFixed(1)}s  (log: ${log})`;
  const verdict = code === 0 ? "VERDICT: PASS" : "VERDICT: FAIL";
  process.stdout.write([head, ...body, verdict].join("\n") + "\n");
  return code;
}

/**
 * Run <repo root>/.haikrew/verify if it is executable, else the command inferred from the project type
 * at the repo root. Exit 2 when neither exists.
 */
export function verify(cwd: string): number {
  const root = repoRoot(cwd);
  const script = join(root, ".haikrew", "verify");
  if (isFile(script) && isExecutable(script)) return run([script], { ...SQUEEZE_OPTIONS, cwd: root });
  const argv = infer(root);
  if (argv === null) {
    process.stdout.write(`verify: no .haikrew/verify and no known project type in ${root}\n`);
    return 2;
  }
  return run(argv, { ...SQUEEZE_OPTIONS, cwd: root });
}

/** Summarizers in priority order, each paired with the command matcher that selects it. */
export const SUMMARIZERS: [(cmd: string) => boolean, Summarizer][] = [
  [(cmd) => words(cmd)[0] === "cargo", cargo],
  [(cmd) => ["swift", "xcodebuild"].includes(words(cmd)[0]), swift],
  [(cmd) => words(cmd).slice(0, 3).includes("pytest"), pytest],
  [(cmd) => JEST_WORDS.has(words(cmd)[0]), jest],
  [(cmd) => words(cmd)[0] === "go", go],
  [() => true, generic],
];

function summarize(cmd: string, output: string): string[] {
  for (const [matches, fn] of SUMMARIZERS) {
    if (!matches(cmd)) continue;
    const lines = fn(output);
    return lines.length ? lines : generic(output);
  }
  return generic(output);
}

function words(cmd: string): string[] {
  return cmd.split(/\s+/).filter(Boolean);
}

function cargo(log: string): string[] {
  const lines = splitLines(log);
  let passed = 0;
  let failed = 0;
  let seen = false;
  const names: string[] = [];
  for (const line of lines) {
    const result = CARGO_RESULT.exec(line);
    if (result) {
      seen = true;
      passed += Number(result[1]);
      failed += Number(result[2]);
      continue;
    }
    const name = CARGO_TEST_FAILED.exec(line);
    if (name) names.push(`FAILED ${name[1]}`);
  }
  const out = seen ? [`tests: ${passed + failed} run, ${failed} failed`] : [];
  out.push(...names.slice(0, ERR_LIMIT));
  for (let i = 0; i < lines.length; i++) {
    if (!CARGO_ERR.test(lines[i])) continue;
    const loc = lines.slice(i + 1, i + 4).map((n) => n.trim()).find((n) => n.startsWith("--> "));
    out.push(lines[i].trim() + (loc ? ` at ${loc.slice(4)}` : ""));
    if (out.length >= ERR_LIMIT + CARGO_ERR_LIMIT) break;
  }
  return out;
}

function swift(log: string): string[] {
  const out: string[] = [];
  for (const line of splitLines(log)) {
    const text = line.trim();
    if (SWIFT_RUN.test(text) || text.includes("recorded an issue at") || SWIFT_ERR.test(text)) out.push(text);
  }
  return out.slice(0, ERR_LIMIT);
}

function pytest(log: string): string[] {
  const lines = splitLines(log);
  const counts = lines.filter((l) => PYTEST_COUNT.test(l)).map((l) => l.replace(/^[ =]+|[ =]+$/g, ""));
  const failed = lines.filter((l) => l.startsWith("FAILED ") || l.startsWith("ERROR ")).map((l) => l.trim());
  return [...counts.slice(-1), ...failed.slice(0, ERR_LIMIT)];
}

function jest(log: string): string[] {
  const out: string[] = [];
  for (const line of splitLines(log)) {
    const text = line.trim();
    if (JEST_LINE.test(text) || text.startsWith("✕")) out.push(text);
  }
  return out.slice(0, ERR_LIMIT);
}

function go(log: string): string[] {
  return splitLines(log).filter((l) => GO_LINE.test(l)).map((l) => l.trim()).slice(0, ERR_LIMIT);
}

/** Deduped error-like lines, then the last few lines of output. */
function generic(log: string): string[] {
  const lines = splitLines(log).map((l) => l.trim()).filter(Boolean);
  const errors = [...new Set(lines.filter((l) => GENERIC_ERR.test(l)))].slice(0, ERR_LIMIT);
  return [...errors, ...lines.slice(-GENERIC_TAIL).filter((l) => !errors.includes(l))];
}

/** The nearest directory at or above start that holds .git, else start itself. */
function repoRoot(start: string): string {
  for (let dir = start; ; dir = dirname(dir)) {
    if (existsSync(join(dir, ".git"))) return dir;
    if (dirname(dir) === dir) return start;
  }
}

function infer(root: string): string[] | null {
  const has = (name: string) => isFile(join(root, name));
  if (has("Cargo.toml")) return ["cargo", "test", "--workspace"];
  if (has("Package.swift")) return ["swift", "test"];
  if (has("package.json") && hasTestScript(join(root, "package.json"))) return ["npm", "test"];
  if (has("pyproject.toml") || has("pytest.ini")) return ["pytest", "-q"];
  if (has("go.mod")) return ["go", "test", "./..."];
  return null;
}

/** True when package.json declares a `test` script. */
function hasTestScript(file: string): boolean {
  try {
    const scripts = JSON.parse(readFileSync(file, "utf8")).scripts || {};
    return typeof scripts === "object" && "test" in scripts;
  } catch {
    return false;
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Write the full output under DATA/logs and return the log path. */
function writeLog(argv: string[], output: string): string {
  const logs = join(DATA, "logs");
  mkdirSync(logs, { recursive: true });
  const slug = argv.join(" ").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "cmd";
  const path = join(logs, `${stamp()}-${slug}.log`);
  writeFileSync(path, output, "utf8");
  return path;
}

/** Local time as YYYYMMDD-HHMMSS-micros, the Python %Y%m%d-%H%M%S-%f layout. */
function stamp(): string {
  const d = new Date();
  const p = (n: number, width = 2) => String(n).padStart(width, "0");
  const micros = p(d.getMilliseconds(), 3) + p(Number(process.hrtime.bigint() / 1000n % 1000n), 3);
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}` +
    `${p(d.getSeconds())}-${micros}`;
}

/**
 * Split a command the way shlex.split does for plain words, '...' and "..." quoting, and backslashes.
 * Shell expansion is not performed.
 */
export function shellSplit(text: string): string[] {
  const out: string[] = [];
  let word: string | null = null;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (/\s/.test(c)) {
      if (word !== null) out.push(word);
      word = null;
      i++;
      continue;
    }
    word ??= "";
    if (c === "'") {
      const end = text.indexOf("'", i + 1);
      if (end < 0) throw new Error("No closing quotation");
      word += text.slice(i + 1, end);
      i = end + 1;
    } else if (c === '"') {
      i++;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === "\\" && '"\\$`\n'.includes(text[i + 1] ?? "\0")) i++;
        word += text[i++];
      }
      if (i >= text.length) throw new Error("No closing quotation");
      i++;
    } else if (c === "\\" && i + 1 < text.length) {
      word += text[i + 1];
      i += 2;
    } else {
      word += c;
      i++;
    }
  }
  if (word !== null) out.push(word);
  return out;
}

/** Names of the pattern files (*.md) in a directory, sorted. Empty when the directory is missing. */
export function listMarkdown(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => n.endsWith(".md") && !n.startsWith(".")).sort();
}
