/**
 * Recall's search, pure so the CLI and the mod's `recall` tool share it: the store is read through injected file and
 * HTTP adapters (node fs and fetch in the CLI, $.fs and $.http.fetch in the mod). A question is embedded once, every
 * stored chunk is scored (cosine similarity plus the exact-word bonus), and the best are returned. Unreadable lines and
 * shards are skipped and counted, never thrown. Also the Embedkit client that both the index and the search use.
 */
import { cosine, decodeVector, exactBonus, linesOf, parseStored, queryWords, sameStamp } from "./recall.ts";
import type { Chunk, Embedded, Stamp } from "./recall.ts";

/** Most hits a search returns when the caller names no count. */
export const DEFAULT_HITS = 8;
/** Inputs per POST to the embedding server; the server refuses more than 64 in one request. */
export const EMBED_BATCH = 64;
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
/** Where the embedding server is and which model and width to ask for. An empty model is the server's default. */
export type EmbedConfig = { url: string; model: string; dims: number };
/** Where the store is, how to reach the embedding server, and the files and HTTP adapters. `root` is the haikrew-recall folder. */
export type SearchEnv = EmbedConfig & { root: string; fs: RecallFs; http: RecallHttp };
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

/** The model and width a manifest records, or null for a manifest written before they were recorded. */
export function stampOfManifest(text: string | null): Stamp | null {
  try {
    const j = JSON.parse(text ?? "") as { model?: unknown; dims?: unknown };
    return typeof j.model === "string" && Number.isInteger(j.dims) ? { model: j.model, dims: j.dims as number } : null;
  } catch {
    return null;
  }
}

/** The stamp as the messages name it: `model@dims`. */
export function stampLabel(stamp: Stamp | null): string {
  return stamp ? `${stamp.model}@${stamp.dims}` : "an older embedder";
}

/** The vectors of one reply, checked: `n` rows, each as wide as the reply's `dims`. Throws when the reply is not that. */
function parseEmbedReply(text: string, n: number): Embedded {
  let j: { model?: unknown; dims?: unknown; embeddings?: unknown } | null;
  try {
    j = JSON.parse(text);
  } catch {
    j = null;
  }
  const model = j?.model;
  const dims = j?.dims;
  const rows = j?.embeddings;
  const ok = typeof model === "string" && Number.isInteger(dims) && Array.isArray(rows) && rows.length === n &&
    rows.every((r) => Array.isArray(r) && r.length === dims);
  if (!ok) throw new Error("embed: unexpected reply");
  return { model: model as string, dims: dims as number, vectors: rows as number[][] };
}

/**
 * Embeds `input` through Embedkit's /v1/embed. The server applies the model's query or document template, so the text
 * goes in as it is. Inputs go in batches of EMBED_BATCH; a reply that changes model or width between batches throws.
 */
export async function embedTexts(http: RecallHttp, cfg: EmbedConfig, kind: "query" | "document", input: string[]): Promise<Embedded> {
  if (input.length === 0) throw new Error("embed: no input");
  const out: Embedded = { model: "", dims: 0, vectors: [] };
  for (let i = 0; i < input.length; i += EMBED_BATCH) {
    const part = input.slice(i, i + EMBED_BATCH);
    const body = { ...(cfg.model ? { model: cfg.model } : {}), kind, input: part, dims: cfg.dims };
    const res = await http.post(`${cfg.url}/v1/embed`, JSON.stringify(body));
    if (!res.ok) throw new Error(`embed: HTTP ${res.status}`);
    const got = parseEmbedReply(res.text, part.length);
    if (i > 0 && !sameStamp(out, got)) throw new Error("embed: model changed during the call");
    out.model = got.model;
    out.dims = got.dims;
    out.vectors.push(...got.vectors);
  }
  return out;
}

/**
 * Every line of every shard of the given projects, in store order. Unreadable shards are counted in `skipped`. Throws
 * when a project's index was built with another model or width than `served`.
 */
async function storedLines(env: SearchEnv, projects: string[], served: Stamp, skipped: { n: number }): Promise<string[]> {
  const out: string[] = [];
  for (const project of projects) {
    const dir = `${env.root}/${project}`;
    const text = await env.fs.read(`${dir}/manifest.json`).catch(() => null);
    if (text === null) continue;
    if (!sameStamp(stampOfManifest(text), served)) {
      throw new Error(`index built with ${stampLabel(stampOfManifest(text))}; run recall index to rebuild`);
    }
    for (const shard of manifestOf(text)) {
      const body = await env.fs.read(`${dir}/${shard}`).catch(() => null);
      if (body === null) skipped.n++;
      else out.push(...linesOf(body));
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

/**
 * The best `n` chunks for `question`, highest score first. Throws when the embedding call fails, or when a searched
 * index was built with a different model or width than the server now gives.
 */
export async function searchStore(env: SearchEnv, question: string, opts: SearchOptions = {}): Promise<SearchResult> {
  const served = await embedTexts(env.http, env, "query", [question]);
  const query = Float32Array.from(served.vectors[0]);
  const words = queryWords(question);
  const skipped = { n: 0 };
  const hits: Hit[] = [];
  for (const line of await storedLines(env, await projectsOf(env, opts.project), served, skipped)) {
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
