/**
 * `haikrew recall index|search|prune|reset`: argument parsing and the commands. The files are in recall-store.ts, the
 * search in recall-search.ts. Settings come from the newest HaiKrew store file, as `late-failures` reads them.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { newestStore } from "./analyze.ts";
import { settingsFrom } from "./mod/config.ts";
import { indexProjects, prune, reset } from "./recall-index.ts";
import { DEFAULT_HITS, formatHits, manifestOf, searchStore } from "./recall-search.ts";
import { nodeFs, nodeHttp, ollamaEmbed, storeIo, storeRoot, takeLock } from "./recall-store.ts";
import { SHARD_MAX, isLoopbackUrl } from "./recall.ts";

/** How long one embed call may take before the batch is skipped and retried next run. */
const EMBED_TIMEOUT_MS = 30_000;
/** How long a search may take: an embed call plus reading the shards. */
const SEARCH_TIMEOUT_MS = 60_000;
const DAY_MS = 86_400_000;
const MB = 1024 * 1024;
const USAGE = "usage: haikrew recall index [--project FOLDER | --all] [--if-enabled] | search QUESTION [--project FOLDER] " +
  "[--session ID] [-n N] | prune --older-than DAYS | reset [--project FOLDER]";

/** The `recall` section of the settings, as the index needs it. */
export type RecallSettings = { enabled: boolean; model: string; url: string; maxMb: number };
type Flags = Record<string, string | true>;

/** The project folder Claude Code keeps a working directory's transcripts in: every character but a letter, digit or dash becomes a dash. */
export function folderOf(dir: string): string {
  return dir.replace(/[^A-Za-z0-9-]/g, "-");
}

/** Splits `--name value`, `--flag` and `-n value` from the positional words. Null for an unknown flag or a missing value. */
function parseArgs(argv: string[]): { flags: Flags; words: string[] } | null {
  const valued = new Set(["project", "session", "n", "older-than"]);
  const boolean = new Set(["all", "if-enabled"]);
  const flags: Flags = {};
  const words: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") {
      words.push(...argv.slice(i + 1));
      break;
    }
    const name = a === "-n" ? "n" : a.startsWith("--") ? a.slice(2) : null;
    if (name === null) words.push(a);
    else if (boolean.has(name)) flags[name] = true;
    else if (valued.has(name) && argv[i + 1] !== undefined) flags[name] = argv[++i];
    else return null;
  }
  return { flags, words };
}

/**
 * The `recall` settings from the newest HaiKrew store file; defaults when there is none. Throws when the Ollama address
 * is not loopback: transcript text must not leave the machine, whatever the settings file says.
 */
export function recallSettings(storeDir: string): RecallSettings {
  const files = listNames(storeDir).map((name) => ({ path: join(storeDir, name), mtime: mtimeOf(join(storeDir, name)) }));
  const path = newestStore(files);
  const stored = path ? parseJson(readText(path)) : null;
  const r = settingsFrom(isObj(stored) ? stored.settings : undefined).recall;
  const url = String(r.url).replace(/\/+$/, "");
  if (!isLoopbackUrl(url)) throw new Error("recall.url must be a loopback address (127.0.0.1, ::1 or localhost)");
  return { enabled: r.enabled === true, model: String(r.model), url, maxMb: Number(r.max_mb) };
}

/** Entry point for `haikrew recall`. Resolves to the exit code. */
export async function recallMain(argv: string[]): Promise<number> {
  const [sub, ...rest] = argv;
  const parsed = parseArgs(rest);
  if (!parsed || !sub) return usage();
  const home = homedir();
  try {
    if (sub === "index") return await indexCmd(parsed.flags, home);
    if (sub === "search") return await searchCmd(parsed.flags, parsed.words, home);
    if (sub === "prune") return withLock(home, () => pruneCmd(parsed.flags, home));
    if (sub === "reset") return withLock(home, () => resetCmd(parsed.flags, home));
    return usage();
  } catch (e) {
    process.stderr.write(`recall: ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
}

/** The project folder a flag names, validated so it cannot reach outside the store. Null when it is malformed. */
function projectFlag(flags: Flags): string | undefined | null {
  if (flags.project === undefined) return undefined;
  const p = flags.project;
  return typeof p === "string" && /^[A-Za-z0-9-]+$/.test(p) ? p : null;
}

/** Runs a writing command under the store lock. A held lock is reported and the command does not run. */
async function withLock<T extends number | Promise<number>>(home: string, run: () => T): Promise<number> {
  const release = takeLock(storeRoot(home));
  if (!release) {
    process.stdout.write("recall: another index run is going\n");
    return 0;
  }
  try {
    return await run();
  } finally {
    release();
  }
}

async function indexCmd(flags: Flags, home: string): Promise<number> {
  const s = recallSettings(join(home, ".claude", "plugins", "store"));
  if (flags["if-enabled"] && !s.enabled) return 0;
  const named = projectFlag(flags);
  if (named === null) return usage();
  const root = storeRoot(home);
  const io = storeIo({ root, projectsDir: join(home, ".claude", "projects"), embed: ollamaEmbed(s, nodeHttp(EMBED_TIMEOUT_MS)) });
  return withLock(home, async () => {
    const projects = flags.all ? io.projects() : [named ?? folderOf(process.cwd())];
    const started = Date.now();
    const res = await indexProjects(io, projects, s.maxMb * MB);
    const size = io.indexed().reduce((sum, p) => sum + io.size(p), 0);
    const shards = io.indexed().reduce((sum, p) => sum + shardCount(root, p), 0);
    process.stdout.write(`recall: ${res.chunks} chunks stored, ${res.failures} transcript(s) stopped at an embed error ` +
      `(retried next run); ${shards} shard(s) of at most ${SHARD_MAX / MB} MB, index ${(size / MB).toFixed(1)} MB; ` +
      `${((Date.now() - started) / 1000).toFixed(1)} s\n`);
    return 0;
  });
}

async function searchCmd(flags: Flags, words: string[], home: string): Promise<number> {
  const question = words.join(" ").trim();
  const project = projectFlag(flags);
  const n = flags.n === undefined ? DEFAULT_HITS : Number(flags.n);
  if (!question || project === null || !Number.isInteger(n) || n < 1) return usage();
  const s = recallSettings(join(home, ".claude", "plugins", "store"));
  const session = typeof flags.session === "string" ? flags.session : undefined;
  const env = { root: storeRoot(home), url: s.url, model: s.model, fs: nodeFs(), http: nodeHttp(SEARCH_TIMEOUT_MS) };
  const res = await searchStore(env, question, { project, session, n });
  if (res.skipped > 0) process.stderr.write(`recall: skipped ${res.skipped} unreadable line(s) or shard(s)\n`);
  process.stdout.write(res.hits.length > 0 ? `${formatHits(res.hits)}\n` : "recall: no hits\n");
  return 0;
}

function pruneCmd(flags: Flags, home: string): number {
  const days = Number(flags["older-than"]);
  if (flags["older-than"] === undefined || !(days >= 0)) return usage();
  const io = storeIo({ root: storeRoot(home), projectsDir: "", embed: async () => [] });
  const dropped = prune(io, Date.now() - days * DAY_MS);
  process.stdout.write(`recall: pruned ${dropped} lines older than ${days} days, or unreadable\n`);
  return 0;
}

function resetCmd(flags: Flags, home: string): number {
  const project = projectFlag(flags);
  if (project === null) return usage();
  const io = storeIo({ root: storeRoot(home), projectsDir: "", embed: async () => [] });
  const count = reset(io, project);
  process.stdout.write(`recall: reset ${count} index${count === 1 ? "" : "es"}\n`);
  return 0;
}

/** How many shard files a project's manifest lists. */
function shardCount(root: string, project: string): number {
  return manifestOf(readText(join(root, project, "manifest.json"))).length;
}

function listNames(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function mtimeOf(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function parseJson(text: string | null): unknown {
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function usage(): number {
  process.stderr.write(`${USAGE}\n`);
  return 2;
}
