/**
 * Recall's index (CLI only): reads the new bytes of each transcript, embeds the chunks in batches and appends them to
 * the project's shards. A batch is stored only once every vector in it is back, and the byte offset moves only with
 * stored chunks, so a failed embed call is retried by the next run. Prune, reset and the size cap also live here.
 * Every file access goes through RecallIo, so the tests run the same code over memory.
 */
import { DOC_PREFIX, encodeVector, entriesOf, linesOf, parseStored, splitText } from "./recall.ts";
import type { Chunk } from "./recall.ts";

/** How many chunks one embed call carries, at most (Ollama takes a list of inputs per call). */
export const BATCH = 32;
const LF = 10;

/** How far into a transcript the index got: bytes read and lines counted (line numbers stay exact across runs). */
export type Offset = { bytes: number; lines: number };

/** The files and calls the index needs. The real one is in recall-store.ts; tests pass an in-memory one. */
export type RecallIo = {
  /** Project folders under ~/.claude/projects. */
  projects(): string[];
  /** Transcript file names (*.jsonl) directly in a project folder. */
  transcripts(project: string): string[];
  /** The bytes of a transcript from `from` to its current end. */
  readFrom(project: string, name: string, from: number): Buffer;
  /** Project folders that have an index. */
  indexed(): string[];
  /** The index text of a project (its shards in order), "" when there is none. */
  readIndex(project: string): string;
  /** The index's size in bytes, 0 when there is none. */
  size(project: string): number;
  /** Adds lines (each ending in a newline) to a project's index. */
  appendIndex(project: string, text: string): void;
  /** Replaces a project's index text. */
  writeIndex(project: string, text: string): void;
  /** The offsets by transcript name; {} when the project has no index. */
  readOffsets(project: string): Record<string, Offset>;
  writeOffsets(project: string, offsets: Record<string, Offset>): void;
  /** Deletes a project's index and offsets. */
  removeIndex(project: string): void;
  /** One embedding per input, in order. Throws when the call fails. */
  embed(texts: string[]): Promise<number[][]>;
  now(): number;
};

/** What an index run did: chunks stored, and transcripts whose batch failed (they resume at the next run). */
export type IndexResult = { chunks: number; failures: number };

/** The chunks a transcript line gives, each with its line number. */
function chunksOfLine(text: string, project: string, line: number): Chunk[] {
  return entriesOf(text).flatMap((e) =>
    splitText(e.text).map((t) => ({ project, session: e.session, line, time: e.time, role: e.role, text: t })));
}

/**
 * Embed `chunks` and append them, then move the transcript's offset to `end`. Returns false, and stores nothing,
 * when any embed call fails or answers with the wrong count.
 */
async function commit(io: RecallIo, project: string, name: string, chunks: Chunk[], end: Offset, offsets: Record<string, Offset>): Promise<boolean> {
  const vectors: number[][] = [];
  try {
    for (let i = 0; i < chunks.length; i += BATCH) {
      const got = await io.embed(chunks.slice(i, i + BATCH).map((c) => DOC_PREFIX + c.text));
      if (got.length !== Math.min(BATCH, chunks.length - i)) return false;
      vectors.push(...got);
    }
  } catch {
    return false;
  }
  if (chunks.length > 0) {
    io.appendIndex(project, chunks.map((c, i) => `${JSON.stringify({ ...c, vec: encodeVector(vectors[i]) })}\n`).join(""));
  }
  offsets[name] = end;
  io.writeOffsets(project, offsets);
  return true;
}

/**
 * Index the new complete lines of one transcript. Chunks are committed every BATCH of them, and at the end of the
 * file. The first failed commit ends this transcript for the run.
 */
async function indexTranscript(io: RecallIo, project: string, name: string, offsets: Record<string, Offset>, res: IndexResult): Promise<void> {
  const from = offsets[name] ?? { bytes: 0, lines: 0 };
  const buf = io.readFrom(project, name, from.bytes);
  let at = 0;
  let lines = from.lines;
  let pending: Chunk[] = [];
  while (true) {
    const nl = buf.indexOf(LF, at);
    if (nl < 0) break;
    lines++;
    pending.push(...chunksOfLine(buf.toString("utf8", at, nl), project, lines));
    at = nl + 1;
    if (pending.length >= BATCH) {
      if (!(await commit(io, project, name, pending, { bytes: from.bytes + at, lines }, offsets))) {
        res.failures++;
        return;
      }
      res.chunks += pending.length;
      pending = [];
    }
  }
  if (at === 0) return;
  if (!(await commit(io, project, name, pending, { bytes: from.bytes + at, lines }, offsets))) {
    res.failures++;
    return;
  }
  res.chunks += pending.length;
}

/**
 * Index the new lines of every transcript in `projects`, then drop the oldest sessions while the stores exceed
 * `maxBytes`. Offsets stay, so a dropped session is not indexed again.
 */
export async function indexProjects(io: RecallIo, projects: string[], maxBytes: number): Promise<IndexResult> {
  const res: IndexResult = { chunks: 0, failures: 0 };
  for (const project of projects) {
    const offsets = io.readOffsets(project);
    for (const name of io.transcripts(project)) await indexTranscript(io, project, name, offsets, res);
  }
  evict(io, maxBytes);
  return res;
}

/** Drops chunks older than `cutoff` (ms since epoch), and unreadable lines, from every index. Returns how many lines went. */
export function prune(io: RecallIo, cutoff: number): number {
  let dropped = 0;
  for (const project of io.indexed()) {
    const all = linesOf(io.readIndex(project));
    const kept = all.filter((l) => {
      const row = parseStored(l);
      return row !== null && Date.parse(row.time) >= cutoff;
    });
    if (kept.length === all.length) continue;
    dropped += all.length - kept.length;
    io.writeIndex(project, kept.map((l) => `${l}\n`).join(""));
  }
  return dropped;
}

/** Deletes the index of one project, or of every project when none is named. Returns how many were deleted. */
export function reset(io: RecallIo, project?: string): number {
  const targets = project === undefined ? io.indexed() : [project];
  for (const p of targets) io.removeIndex(p);
  return targets.length;
}

/**
 * While the stores total more than `maxBytes`, drop the sessions with the oldest last message until they fit.
 * Returns the number of sessions dropped. Reads the stores only when they are over the limit. Unreadable lines go too.
 */
export function evict(io: RecallIo, maxBytes: number): number {
  const projects = io.indexed();
  if (projects.reduce((sum, p) => sum + io.size(p), 0) <= maxBytes) return 0;
  const texts = new Map<string, string[]>();
  const sessions = new Map<string, { bytes: number; last: number }>();
  let total = 0;
  for (const project of projects) {
    const lines = linesOf(io.readIndex(project));
    texts.set(project, lines);
    for (const line of lines) {
      const row = parseStored(line);
      if (!row) continue;
      const key = `${project}\n${row.session}`;
      const bytes = Buffer.byteLength(line) + 1;
      const s = sessions.get(key) ?? { bytes: 0, last: 0 };
      s.bytes += bytes;
      s.last = Math.max(s.last, Date.parse(row.time) || 0);
      sessions.set(key, s);
      total += bytes;
    }
  }
  const dropped = new Set<string>();
  for (const [key, s] of [...sessions].sort((a, b) => a[1].last - b[1].last)) {
    if (total <= maxBytes) break;
    dropped.add(key);
    total -= s.bytes;
  }
  for (const [project, lines] of texts) {
    const kept = lines.filter((l) => {
      const row = parseStored(l);
      return row !== null && !dropped.has(`${project}\n${row.session}`);
    });
    if (kept.length !== lines.length) io.writeIndex(project, kept.map((l) => `${l}\n`).join(""));
  }
  return dropped.size;
}
