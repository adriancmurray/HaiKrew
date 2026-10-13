/**
 * Recall's search, pure so the CLI and the mod's `recall` tool share it: the store is read through injected file and
 * HTTP adapters (node fs and fetch in the CLI, $.fs and $.http.fetch in the mod). A question is embedded once, every
 * stored chunk is scored (cosine similarity plus the exact-word bonus), and the best are returned. Unreadable lines and
 * shards are skipped and counted, never thrown.
 */
import { QUERY_PREFIX, cosine, decodeVector, exactBonus, linesOf, parseStored, queryWords } from "./recall.ts";
import type { Chunk } from "./recall.ts";

/** Most hits a search returns when the caller names no count. */
export const DEFAULT_HITS = 8;
/** Characters of a hit's text the text form shows. */
const SNIPPET = 300;
/** A project folder name, as Claude Code writes it. Anything else is not read. */
const FOLDER = /^[A-Za-z0-9-]+$/;
/** A shard file name, as the index writes it. */
const SHARD = /^\d+\.jsonl$/;

/** Reads a file's text (rejects when missing) and lists the folder names under a directory (rejects when missing). */
export type RecallFs = { read(path: string): Promise<string>; list(dir: string): Promise<string[]> };
/** POSTs a JSON body and resolves the status and body text. Rejects only when the request cannot be made at all. */
export type RecallHttp = { post(url: string, body: string): Promise<{ ok: boolean; status: number; text: string }> };
/** Where the store is and how to reach the embedding server. `root` is ~/.claude/plugins/store/haikrew-recall. */
export type SearchEnv = { root: string; url: string; model: string; fs: RecallFs; http: RecallHttp };
/** Which part of the store to search: one project folder, one session, and how many hits. */
export type SearchOptions = { project?: string; session?: string; n?: number };
/** A stored chunk and its score for one question. */
export type Hit = Chunk & { score: number };
/** The best hits, and how many stored lines or shards could not be read. */
export type SearchResult = { hits: Hit[]; skipped: number };

/** The shard file names a project's manifest lists, in order. Empty for anything that is not a manifest. */
export function manifestOf(text: string | null): string[] {
  try {
    const j: unknown = JSON.parse(text ?? "");
    const shards = typeof j === "object" && j !== null ? (j as { shards?: unknown }).shards : undefined;
    return Array.isArray(shards) ? shards.filter((s): s is string => typeof s === "string" && SHARD.test(s)) : [];
  } catch {
    return [];
  }
}

/** The question's embedding, or an error when the server's reply does not hold one vector. */
async function embedQuery(env: SearchEnv, question: string): Promise<Float32Array> {
  const res = await env.http.post(`${env.url}/api/embed`, JSON.stringify({ model: env.model, input: [QUERY_PREFIX + question] }));
  if (!res.ok) throw new Error(`embed: HTTP ${res.status}`);
  let vectors: unknown;
  try {
    vectors = (JSON.parse(res.text) as { embeddings?: unknown }).embeddings;
  } catch {
    vectors = undefined;
  }
  const first = Array.isArray(vectors) ? vectors[0] : undefined;
  if (!Array.isArray(first) || first.length === 0) throw new Error("embed: unexpected reply");
  return Float32Array.from(first as number[]);
}

/** Every line of every shard of the given projects, in store order. Unreadable shards are counted in `skipped`. */
async function storedLines(env: SearchEnv, projects: string[], skipped: { n: number }): Promise<Iterable<string>> {
  const out: string[] = [];
  for (const project of projects) {
    const dir = `${env.root}/${project}`;
    const shards = manifestOf(await env.fs.read(`${dir}/manifest.json`).catch(() => null));
    for (const shard of shards) {
      const text = await env.fs.read(`${dir}/${shard}`).catch(() => null);
      if (text === null) skipped.n++;
      else out.push(...linesOf(text));
    }
  }
  return out;
}

/** The projects to search: the named one, or every folder under the store root. */
async function projectsOf(env: SearchEnv, project: string | undefined): Promise<string[]> {
  if (project !== undefined) return FOLDER.test(project) ? [project] : [];
  const names = await env.fs.list(env.root).catch(() => [] as string[]);
  return names.filter((n) => FOLDER.test(n));
}

/** The best `n` chunks for `question`, highest score first. Throws when the embedding call fails. */
export async function searchStore(env: SearchEnv, question: string, opts: SearchOptions = {}): Promise<SearchResult> {
  const query = await embedQuery(env, question);
  const words = queryWords(question);
  const skipped = { n: 0 };
  const hits: Hit[] = [];
  for (const line of await storedLines(env, await projectsOf(env, opts.project), skipped)) {
    const row = parseStored(line);
    const vec = row ? decodeVector(row.vec) : null;
    if (!row || !vec) {
      skipped.n++;
      continue;
    }
    if (opts.session !== undefined && row.session !== opts.session) continue;
    const { vec: _vec, ...chunk } = row;
    hits.push({ ...chunk, score: cosine(vec, query) + exactBonus(words, row.text) });
  }
  hits.sort((a, b) => b.score - a.score);
  return { hits: hits.slice(0, opts.n ?? DEFAULT_HITS), skipped: skipped.n };
}

/** Hits as text: `date role session:line`, then the first characters of the text on the next line. */
export function formatHits(hits: Hit[]): string {
  return hits.map((h) => {
    const flat = h.text.replace(/\s+/g, " ").trim();
    const snippet = flat.length > SNIPPET ? `${flat.slice(0, SNIPPET)}…` : flat;
    return `${h.time.slice(0, 10)} ${h.role} ${h.session}:${h.line}\n  ${snippet}`;
  }).join("\n");
}
