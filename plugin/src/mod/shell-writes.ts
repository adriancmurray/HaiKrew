/**
 * Which Bash commands write files, and which paths do not count toward review size. Pure text matching on the
 * command line, not a shell parser. ponytail: paths with spaces, `$VARS` and nested subshells are not understood
 * (such a write is reported with no path); the upgrade path is a real shell tokenizer.
 */

/** Paths that are scratch space, not the agent's working tree: they never count toward review size or tier. */
export function outsideTree(path: string): boolean {
  return /^(?:\/tmp|\/private\/tmp|\/var\/folders)(?:\/|$)/.test(path) || /(?:^|\/)scratchpad(?:\/|$)/.test(path);
}

const ALL_ARGS = new Set(["tee", "mv", "touch", "mkdir", "rmdir", "rm", "truncate"]);
const LAST_ARG = new Set(["cp", "install", "ln"]);
const GIT_WRITES = new Set(["apply", "checkout", "restore", "commit", "mv", "rm"]);
const INTERPRETERS = /^(?:python[\d.]*|node|bun|deno|ts-node)$/;
// Code that opens a file for writing: Python open(.., 'w'/'a'/'x'), Node's fs writers, pathlib writers.
const WRITES_FILE = /open\([^)]*['"][wax][+b]*['"]|writeFileSync|appendFileSync|fs\.(?:promises\.)?(?:writeFile|appendFile)|write_text|write_bytes/;
const SKIP_HEADS = new Set(["sudo", "command", "time", "env", "nohup"]);
const DEVICES = new Set(["/dev/null", "/dev/stdout", "/dev/stderr", "/dev/tty"]);

/** A heredoc's body removed (its opening line stays), so text inside it is not read as shell. */
function withoutHeredocBodies(command: string): string {
  return command.replace(/(<<-?\s*(['"]?)(\w+)\2[^\n]*)\n[\s\S]*?(?:\n\s*\3[ \t]*(?=\n|$)|$)/g, "$1\n");
}

const nonFlags = (args: string[]): string[] => args.filter((a) => a !== "" && !a.startsWith("-") && a !== "Q");
const known = (p: string): boolean => p !== "" && p !== "Q" && !/[$`]/.test(p);

/**
 * The paths a Bash command writes, as far as they can be read from it; null when the command writes no file. An empty
 * array means it writes but no path could be parsed. Read-only commands (cat, grep, ls, git status, node --test) are null.
 */
export function shellWrites(command: string): string[] | null {
  const body = withoutHeredocBodies(command);
  // Quoted strings become one placeholder token, so a `>` or a command name inside quotes is not read as shell.
  const flat = body.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, "Q");
  let wrote = false;
  const paths: string[] = [];
  for (const m of flat.matchAll(/(?<![=\-<>])(?:\d|&)?>>?(?!&)\s*([^\s;&|<>()]+)/g)) {
    const target = m[1] ?? "";
    if (DEVICES.has(target)) continue;
    wrote = true;
    if (known(target)) paths.push(target);
  }
  for (const segment of flat.split(/&&|\|\||;|\||\n/)) {
    const tokens = segment.trim().split(/\s+/).filter(Boolean);
    while (tokens.length > 0 && (/^\w+=/.test(tokens[0] ?? "") || SKIP_HEADS.has(tokens[0] ?? ""))) tokens.shift();
    const head = (tokens.shift() ?? "").split("/").pop() ?? "";
    const args = nonFlags(tokens);
    if (ALL_ARGS.has(head)) {
      wrote = true;
      paths.push(...args.filter(known));
    } else if (LAST_ARG.has(head)) {
      wrote = true;
      if (known(args.at(-1) ?? "")) paths.push(args.at(-1) as string);
    } else if ((head === "sed" || head === "perl") && tokens.some((t) => /^-[A-Za-z]*i/.test(t) || t.startsWith("--in-place"))) {
      wrote = true;
      if (known(args.at(-1) ?? "")) paths.push(args.at(-1) as string);
    } else if (head === "git" && GIT_WRITES.has(args[0] ?? "")) {
      wrote = true;
    } else if (head === "patch") {
      wrote = true;
    } else if (INTERPRETERS.test(head) && WRITES_FILE.test(command)) {
      wrote = true;
    }
  }
  return wrote ? [...new Set(paths)] : null;
}
