/**
 * Recall's files, for the CLI: a project's index is a folder under the store root holding `manifest.json` (the shard
 * names in order, and the model and width the vectors were made with), `NNNN.jsonl` shards of at most SHARD_MAX bytes,
 * and `offsets.json`. Also the store-wide lock and the
 * node adapters that the pure search module reads the store through.
 */
import { appendFileSync, closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync,
  rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RecallFs, RecallHttp } from "./recall-search.ts";
import { manifestOf, stampOfManifest } from "./recall-search.ts";
import type { Offset, RecallIo } from "./recall-index.ts";
import { SHARD_MAX, linesOf } from "./recall.ts";
import type { Stamp } from "./recall.ts";

/** An index lock older than this belongs to a run that died, and is taken over. */
const LOCK_STALE_MS = 30 * 60_000;
const LOCK = ".lock";
const LF = 10;

/** The folder that holds every project's index, under the HaiKrew store folder. */
export function storeRoot(home: string): string {
  return join(home, ".claude", "plugins", "store", "haikrew-recall");
}

/** The real files behind RecallIo. `shardMax` is SHARD_MAX except in tests. */
export function storeIo(opts: { root: string; projectsDir: string; embed: RecallIo["embed"]; shardMax?: number }): RecallIo {
  const { root, projectsDir, embed } = opts;
  const shardMax = opts.shardMax ?? SHARD_MAX;
  const dir = (p: string): string => join(root, p);
  const manifestPath = (p: string): string => join(dir(p), "manifest.json");
  const names = (p: string): string[] => manifestOf(readText(manifestPath(p)));
  return {
    projects: () => listDirs(projectsDir),
    transcripts: (p) => listNames(join(projectsDir, p)).filter((n) => n.endsWith(".jsonl") && isFile(join(projectsDir, p, n))),
    readFrom: (p, name, from) => {
      const path = join(projectsDir, p, name);
      const buf = Buffer.alloc(Math.max(0, statSync(path).size - from));
      const fd = openSync(path, "r");
      try {
        return buf.subarray(0, readSync(fd, buf, 0, buf.length, from));
      } finally {
        closeSync(fd);
      }
    },
    indexed: () => listDirs(root).filter((p) => existsSync(manifestPath(p))),
    readIndex: (p) => {
      const lines = names(p).flatMap((n) => linesOf(readText(join(dir(p), n)) ?? ""));
      return lines.length ? `${lines.join("\n")}\n` : "";
    },
    stampOf: (p) => stampOfManifest(readText(manifestPath(p))),
    writeStamp: (p, stamp: Stamp) => {
      mkdirSync(dir(p), { recursive: true });
      writeAtomic(manifestPath(p), JSON.stringify({ shards: names(p), model: stamp.model, dims: stamp.dims }));
    },
    size: (p) => names(p).reduce((sum, n) => sum + sizeOf(join(dir(p), n)), 0),
    appendIndex: (p, text) => appendShards(dir(p), text, shardMax),
    writeIndex: (p, text) => rewriteShards(dir(p), text, shardMax),
    readOffsets: (p) => {
      if (!existsSync(manifestPath(p))) return {};
      const o = parseJson(readText(join(dir(p), "offsets.json")));
      return isObj(o) ? (o as Record<string, Offset>) : {};
    },
    writeOffsets: (p, offsets) => {
      mkdirSync(dir(p), { recursive: true });
      if (!existsSync(manifestPath(p))) writeManifest(dir(p), []);
      writeAtomic(join(dir(p), "offsets.json"), JSON.stringify(offsets));
    },
    removeIndex: (p) => rmSync(dir(p), { recursive: true, force: true }),
    embed,
    now: Date.now,
  };
}

/**
 * Appends whole lines to the last shard, opening a new shard (and recording it in the manifest first) when the next
 * line would pass `shardMax`. A shard left without a final newline by an interrupted write gets one before new lines.
 */
function appendShards(d: string, text: string, shardMax: number): void {
  mkdirSync(d, { recursive: true });
  const list = manifestOf(readText(join(d, "manifest.json")));
  let cur = list.at(-1);
  let size = cur ? sizeOf(join(d, cur)) : 0;
  let started = cur !== undefined;
  let out = cur && size > 0 && !endsWithNewline(join(d, cur)) ? "\n" : "";
  const flush = (): void => {
    if (out && cur) {
      if (started) appendFileSync(join(d, cur), out);
      else writeFileSync(join(d, cur), out);
    }
    started = true;
    out = "";
  };
  for (const line of text.split(/(?<=\n)/).filter((l) => l.length > 0)) {
    const bytes = Buffer.byteLength(line);
    if (!cur || (size > 0 && size + bytes > shardMax)) {
      flush();
      cur = nextShard(list.at(-1));
      list.push(cur);
      writeManifest(d, list);
      size = 0;
      started = false;
    }
    out += line;
    size += bytes;
  }
  flush();
}

/**
 * Replaces the project's index with `text`, re-sharded under names past the old ones. The manifest moves to the new
 * shards in one atomic write, and only then are the old shards deleted, so a crash leaves the old index whole.
 */
function rewriteShards(d: string, text: string, shardMax: number): void {
  mkdirSync(d, { recursive: true });
  const old = manifestOf(readText(join(d, "manifest.json")));
  const fresh: string[] = [];
  let out = "";
  let size = 0;
  let started = false;
  const flush = (): void => {
    if (out && fresh.length > 0) {
      const path = join(d, fresh[fresh.length - 1]);
      if (started) appendFileSync(path, out);
      else writeFileSync(path, out);
    }
    started = true;
    out = "";
  };
  for (const line of linesOf(text).map((l) => `${l}\n`)) {
    const bytes = Buffer.byteLength(line);
    if (fresh.length === 0 || size + bytes > shardMax) {
      flush();
      fresh.push(nextShard(fresh.at(-1) ?? old.at(-1)));
      size = 0;
      started = false;
    }
    out += line;
    size += bytes;
  }
  flush();
  writeManifest(d, fresh);
  for (const n of old) if (!fresh.includes(n)) rmSync(join(d, n), { force: true });
}

/** The shard name after `last`: "0001.jsonl" after nothing, "0008.jsonl" after "0007.jsonl". */
function nextShard(last: string | undefined): string {
  const n = last ? parseInt(last, 10) + 1 : 1;
  return `${String(n).padStart(4, "0")}.jsonl`;
}

/** Writes the shard list, keeping the stamp the manifest already records. */
function writeManifest(d: string, shards: string[]): void {
  mkdirSync(d, { recursive: true });
  const stamp = stampOfManifest(readText(join(d, "manifest.json")));
  writeAtomic(join(d, "manifest.json"), JSON.stringify({ shards, ...stamp }));
}

/**
 * Takes the store-wide lock (`.lock` holding the pid and the time). A lock held by a live process and younger than
 * LOCK_STALE_MS is kept: the result is null. Otherwise it is taken over. The returned function releases it.
 */
export function takeLock(root: string): (() => void) | null {
  mkdirSync(root, { recursive: true });
  const path = join(root, LOCK);
  const held = /^(\d+) (\d+)$/.exec(readText(path) ?? "");
  if (held && !stale(Number(held[1]), Number(held[2]))) return null;
  rmSync(path, { force: true });
  try {
    writeFileSync(path, `${process.pid} ${Date.now()}`, { flag: "wx" });
  } catch {
    return null;
  }
  return () => rmSync(path, { force: true });
}

/** Whether a lock's owner is gone or the lock is too old. */
function stale(pid: number, at: number): boolean {
  if (Date.now() - at > LOCK_STALE_MS) return true;
  try {
    process.kill(pid, 0);
    return false;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code !== "EPERM";
  }
}

/** File reads and folder listings for the search, through node. A missing path rejects. */
export function nodeFs(): RecallFs {
  return {
    read: async (path) => readFileSync(path, "utf8"),
    list: async (dir) => listDirs(dir),
  };
}

/** POSTs through the global fetch, with a timeout. Only a request that cannot be made rejects. */
export function nodeHttp(timeoutMs: number): RecallHttp {
  return {
    post: async (url, body) => {
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body, signal: AbortSignal.timeout(timeoutMs) });
      return { ok: res.ok, status: res.status, text: await res.text() };
    },
  };
}

/** True when a file's last byte is a newline (an empty file counts as ending with one). */
function endsWithNewline(path: string): boolean {
  try {
    const fd = openSync(path, "r");
    try {
      const size = fstatSync(fd).size;
      if (size === 0) return true;
      const b = Buffer.alloc(1);
      readSync(fd, b, 0, 1, size - 1);
      return b[0] === LF;
    } finally {
      closeSync(fd);
    }
  } catch {
    return true;
  }
}

function writeAtomic(path: string, text: string): void {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

function sizeOf(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

function listNames(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function listDirs(dir: string): string[] {
  return listNames(dir).filter((n) => isDir(join(dir, n)));
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
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
