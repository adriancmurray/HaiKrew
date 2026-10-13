/**
 * Which Bash commands write files, and which paths do not count toward review size. Pure text matching on the
 * command line, not a shell parser. ponytail: nested subshells are not understood, and a target with `$` or a
 * backtick is reported as DYNAMIC_WRITE rather than resolved; the upgrade path is a real shell tokenizer.
 */

/** Paths that are scratch space, not the agent's working tree: they never count toward review size or tier. */
export function outsideTree(path: string): boolean {
  return /^(?:\/tmp|\/private\/tmp|\/var\/folders)(?:\/|$)/.test(path) || /(?:^|\/)scratchpad(?:\/|$)/.test(path);
}

/**
 * The path reported for a git command that rewrites the whole working tree or history (commit, checkout, restore,
 * merge, reset --hard, stash pop or apply). No single file is known, so the repo stands for itself.
 */
export const REPO_WRITE = "<repo>";
/** The path reported for a write whose target has a `$` or a backtick: its real path is not known from the text. */
export const DYNAMIC_WRITE = "<dynamic>";

const ALL_ARGS = new Set(["tee", "mv", "touch", "mkdir", "rmdir", "rm", "truncate"]);
const LAST_ARG = new Set(["cp", "install", "ln"]);
const REPO_GIT = new Set(["commit", "checkout", "restore", "merge"]);
const GIT_WRITES = new Set(["apply", "mv", "rm"]);
const INTERPRETERS = /^(?:python[\d.]*|node|bun|deno|ts-node)$/;
// Code that opens a file for writing: Python open(.., 'w'/'a'/'x'), Node's fs writers, pathlib writers.
const WRITES_FILE = /open\([^)]*['"][wax][+b]*['"]|writeFileSync|appendFileSync|fs\.(?:promises\.)?(?:writeFile|appendFile)|write_text|write_bytes/;
const SKIP_HEADS = new Set(["sudo", "command", "time", "env", "nohup"]);
// Targets that are not files: a device, or `-` (stdout for curl, a stream for tee).
const NOT_FILES = new Set(["/dev/null", "/dev/stdout", "/dev/stderr", "/dev/tty", "-"]);
// `sh -c "..."` or `bash -c '...'` (also -lc and the like): the quoted string is a command of its own.
const SHELL_C = /(?:^|[\s;&|(])(?:\S*\/)?(?:sh|bash|zsh|dash)\s+-[A-Za-z]*c\s+(?:"((?:[^"\\]|\\.)*)"|'([^']*)')/g;
// A quoted string, masked in the flat text as NUL and its index in the quoted list, so its content stays readable.
const QUOTED = /"((?:[^"\\]|\\.)*)"|'([^']*)'/g;
const PLACEHOLDER = /\u0000(\d+)/g;
// A redirection: `>`, `>>`, `>|`, `>&file` (not `>&1` or `>&-`), with an optional fd or `&` before it.
const REDIRECT = /(?<![=\-<>])(?:\d|&)?>>?\|?(?:&(?![\d-])|(?!&))\s*([^\s;&|<>()]+)/g;

/** A heredoc's body removed (its opening line stays), so text inside it is not read as shell. */
function withoutHeredocBodies(command: string): string {
  return command.replace(/(<<-?\s*(['"]?)(\w+)\2[^\n]*)\n[\s\S]*?(?:\n\s*\3[ \t]*(?=\n|$)|$)/g, "$1\n");
}

/** A flat token with its quoted strings put back. */
function unwrap(token: string, quoted: string[]): string {
  return token.replace(PLACEHOLDER, (_m, i: string) => quoted[Number(i)] ?? "");
}

const nonFlags = (args: string[]): string[] => args.filter((a) => a !== "" && !a.startsWith("-"));

/** Adds the targets as written paths: an empty one is nothing, one with `$` or a backtick is DYNAMIC_WRITE. */
function addTargets(paths: string[], targets: string[]): void {
  for (const t of targets) {
    if (t !== "") paths.push(/[$`]/.test(t) ? DYNAMIC_WRITE : t);
  }
}

/**
 * Files a command writes, minus devices and stdout. False when it names only such targets, so it writes no file;
 * true (with any real targets added) otherwise, including when it names none.
 */
function filesWritten(paths: string[], files: string[]): boolean {
  const real = files.filter((f) => !NOT_FILES.has(f));
  if (files.length > 0 && real.length === 0) return false;
  addTargets(paths, real);
  return true;
}

/** The files `sed -i` or `perl -i` edits: every operand after the script (the first operand, or the -e/-f value). */
function inPlaceFiles(tokens: string[]): string[] {
  const files: string[] = [];
  let scripted = false;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i] ?? "";
    if (/^(?:-e|-f|--expression|--file)$/.test(t)) {
      scripted = true;
      i++;
    } else if (/^--(?:expression|file)=/.test(t)) {
      scripted = true;
    } else if (t === "" || t.startsWith("-")) {
      // An empty operand is BSD sed's `-i ''` suffix, not a file.
      continue;
    } else if (scripted) {
      files.push(t);
    } else {
      scripted = true;
    }
  }
  return files;
}

/** The git subcommand's arguments, after global options: `-C <dir>` and `-c <key=value>` take a value. */
function afterGitGlobals(tokens: string[]): string[] {
  let i = 0;
  while (i < tokens.length && (tokens[i] ?? "").startsWith("-")) i += tokens[i] === "-C" || tokens[i] === "-c" ? 2 : 1;
  return tokens.slice(i);
}

/** Git subcommands that rewrite the repo as a whole: commit, checkout, restore, merge, reset --hard, stash pop or apply. */
function rewritesRepo(rest: string[]): boolean {
  const sub = rest[0] ?? "";
  if (REPO_GIT.has(sub)) return true;
  if (sub === "reset") return rest.includes("--hard");
  return sub === "stash" && ["pop", "apply"].includes(rest[1] ?? "");
}

/** `curl -o <file>` or `curl --output <file>` writes that file. */
function curlWrites(tokens: string[], paths: string[]): boolean {
  const at = tokens.findIndex((t) => t === "-o" || t === "--output");
  return at >= 0 && filesWritten(paths, [tokens[at + 1] ?? ""]);
}

/** Whether a git command writes, adding REPO_WRITE for a repo-wide rewrite. */
function gitWrites(tokens: string[], paths: string[]): boolean {
  const rest = afterGitGlobals(tokens);
  if (rewritesRepo(rest)) {
    paths.push(REPO_WRITE);
    return true;
  }
  return GIT_WRITES.has(rest[0] ?? "");
}

/**
 * One simple command (no `&&`, `;`, `|`): whether it writes, adding any paths it writes to `paths`. `command` is the
 * whole Bash command, which the interpreter check reads; `quoted` is the list the segment's placeholders refer to.
 */
function segmentWrites(segment: string, command: string, quoted: string[], paths: string[]): boolean {
  const tokens = segment.trim().split(/\s+/).filter(Boolean).map((t) => unwrap(t, quoted));
  while (tokens.length > 0 && (/^\w+=/.test(tokens[0] ?? "") || SKIP_HEADS.has(tokens[0] ?? ""))) tokens.shift();
  const head = (tokens.shift() ?? "").split("/").pop() ?? "";
  const args = nonFlags(tokens);
  if (ALL_ARGS.has(head)) return filesWritten(paths, args);
  if (LAST_ARG.has(head)) return filesWritten(paths, args.slice(-1));
  if ((head === "sed" || head === "perl") && tokens.some((t) => /^-[A-Za-z]*i/.test(t) || t.startsWith("--in-place"))) {
    return filesWritten(paths, inPlaceFiles(tokens));
  }
  if (head === "curl") return curlWrites(tokens, paths);
  if (head === "dd") {
    const of = tokens.find((t) => t.startsWith("of="));
    return of !== undefined && filesWritten(paths, [of.slice(3)]);
  }
  if (head === "git") return gitWrites(tokens, paths);
  if (head === "patch") return true;
  return INTERPRETERS.test(head) && WRITES_FILE.test(command);
}

/**
 * The paths a Bash command writes, as far as they can be read from it; null when the command writes no file. An empty
 * array means it writes but no path could be parsed. Read-only commands (cat, grep, ls, git status, node --test) are null.
 * The command inside `sh -c` or `bash -c` is read as a command of its own. Devices (/dev/null) are not writes.
 */
export function shellWrites(command: string): string[] | null {
  const body = withoutHeredocBodies(command);
  let wrote = false;
  const paths: string[] = [];
  for (const m of body.matchAll(SHELL_C)) {
    const inner = shellWrites(m[2] ?? (m[1] ?? "").replace(/\\(["\\$`])/g, "$1"));
    if (inner) {
      wrote = true;
      paths.push(...inner);
    }
  }
  // A `>` or a command name inside quotes is not read as shell; a quoted redirect target is read back unquoted.
  const quoted: string[] = [];
  const flat = body.replace(QUOTED, (_m, dq: string | undefined, sq: string | undefined) => {
    quoted.push(dq !== undefined ? dq.replace(/\\(["\\$`])/g, "$1") : (sq ?? ""));
    return `\u0000${quoted.length - 1}`;
  });
  for (const m of flat.matchAll(REDIRECT)) {
    const target = unwrap(m[1] ?? "", quoted);
    if (NOT_FILES.has(target)) continue;
    wrote = true;
    addTargets(paths, [target]);
  }
  for (const segment of flat.split(/&&|\|\||;|\||\n/)) {
    if (segmentWrites(segment, command, quoted, paths)) wrote = true;
  }
  return wrote ? [...new Set(paths)] : null;
}
