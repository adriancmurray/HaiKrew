/**
 * Recall's pure core, shared by the CLI and the mod (so no Node APIs here): which transcript lines are worth indexing,
 * how long text is cut into chunks, how vectors are stored (float32 in base64), how a stored line is read back, and
 * the loopback check on the Ollama address.
 */
import { handbackText } from "./mod/ledger.ts";
import { LOOPBACK_PATTERN } from "./schema.ts";

/** Longest chunk the index embeds, in characters; longer messages are cut at paragraph breaks. */
export const CHUNK_MAX = 1500;
/** The weight of the exact-word bonus; the fraction of question words found whole in the chunk, times this. */
export const EXACT_WEIGHT = 0.1;
/** Largest shard file, in bytes. The mod reads a shard with $.fs.read, which caps a read at 4 MiB. */
export const SHARD_MAX = 3 * 1024 * 1024;
/** EmbeddingGemma's documented task prefixes: retrieval quality depends on them. */
export const DOC_PREFIX = "title: none | text: ";
export const QUERY_PREFIX = "task: search result | query: ";

/** Who said the text: the person, the assistant, or a subagent's hand-back report. */
export type Role = "person" | "assistant" | "handback";
/** A piece of a transcript line the index keeps. `time` and `session` are as the transcript gives them. */
export type Entry = { role: Role; text: string; time: string; session: string };
/** One stored chunk. `line` is the 1-based line in the transcript file. */
export type Chunk = { project: string; session: string; line: number; time: string; role: Role; text: string };
/** A stored line: a chunk with its vector as base64 float32. */
export type StoredChunk = Chunk & { vec: string };

type Obj = Record<string, unknown>;

/** Harness-injected user text: a message whose trimmed text starts with one of these is not the person's. */
const INJECTED_START = [
  "<system-reminder>", "<task-notification>", "<local-command", "<command-", "<bash-",
  "Another Claude session sent a message", "HaiKrew review:", "This session is being continued", "[Request interrupted",
];
const REMINDER = /<system-reminder>[\s\S]*?<\/system-reminder>/g;
/** Words too common to count as an exact match. */
const STOP = new Set(["the", "and", "for", "that", "this", "with", "what", "why", "how", "did", "was", "were", "are",
  "have", "has", "had", "from", "about", "when", "where", "which", "who", "our", "your", "not", "but", "can", "does"]);
const ROLES = new Set<string>(["person", "assistant", "handback"]);
const LOOPBACK = new RegExp(LOOPBACK_PATTERN);

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The text without system-reminder blocks, trimmed. */
function clean(text: string): string {
  return text.replace(REMINDER, "").trim();
}

/** The person's text in one user block: "" when it is empty or harness-injected. */
function personText(raw: string): string {
  const text = clean(raw);
  return INJECTED_START.some((p) => text.startsWith(p)) ? "" : text;
}

/** The record objects in a message's content array; anything else gives none. */
function blocksOf(content: unknown): Obj[] {
  return Array.isArray(content) ? content.filter(isObj) : [];
}

/**
 * The indexable entries of one transcript line: the person's typed text, the assistant's text blocks and the report of
 * each SubagentHandback call. Tool calls, tool output, notices, compaction summaries and unparseable lines give none.
 */
export function entriesOf(line: string): Entry[] {
  let j: unknown;
  try {
    j = JSON.parse(line);
  } catch {
    return [];
  }
  if (!isObj(j) || typeof j.sessionId !== "string" || typeof j.timestamp !== "string") return [];
  const base = { time: j.timestamp, session: j.sessionId };
  const content = isObj(j.message) ? j.message.content : undefined;
  const out: Entry[] = [];
  const add = (role: Role, text: string): void => {
    if (text) out.push({ role, text, ...base });
  };
  if (j.type === "user") {
    if (j.isMeta === true || j.isCompactSummary === true) return out;
    if (typeof content === "string") add("person", personText(content));
    for (const b of blocksOf(content)) {
      if (b.type === "text" && typeof b.text === "string") add("person", personText(b.text));
    }
  } else if (j.type === "assistant") {
    if (typeof content === "string") add("assistant", clean(content));
    for (const b of blocksOf(content)) {
      if (b.type === "text" && typeof b.text === "string") add("assistant", clean(b.text));
      const handed = handbackText(b);
      if (handed !== null) add("handback", clean(handed));
    }
  }
  return out;
}

/**
 * Cut `text` into chunks of at most `max` characters: paragraphs (blank-line separated) are packed together, and a
 * paragraph longer than `max` is cut on its own. Text that fits comes back whole.
 */
export function splitText(text: string, max = CHUNK_MAX): string[] {
  if (text.length <= max) return [text];
  const out: string[] = [];
  let cur = "";
  const flush = (): void => {
    if (cur) out.push(cur);
    cur = "";
  };
  for (const para of text.split(/\n\s*\n/)) {
    if (para.length > max) {
      flush();
      for (let i = 0; i < para.length; i += max) out.push(para.slice(i, i + max));
      continue;
    }
    if (cur && cur.length + 2 + para.length > max) flush();
    cur = cur ? `${cur}\n\n${para}` : para;
  }
  flush();
  return out;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** The float32 bytes of a vector, base64 encoded (standard alphabet, padded). */
export function encodeVector(v: ArrayLike<number>): string {
  const bytes = new Uint8Array(Float32Array.from(v).buffer);
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const left = bytes.length - i;
    for (let k = 0; k < 4; k++) out += k <= left ? B64[(n >> (18 - 6 * k)) & 63] : "=";
  }
  return out;
}

/** The vector a base64 float32 string holds, or null when the text is not whole float32 values. */
export function decodeVector(b64: string): Float32Array | null {
  const bytes = new Uint8Array(Math.floor((b64.length * 3) / 4));
  let n = 0;
  let buf = 0;
  let bits = 0;
  for (const ch of b64) {
    if (ch === "=") break;
    const v = B64.indexOf(ch);
    if (v < 0) return null;
    buf = ((buf << 6) | v) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[n++] = (buf >> bits) & 0xff;
    }
  }
  if (n === 0 || n % 4 !== 0) return null;
  return new Float32Array(bytes.slice(0, n).buffer);
}

/** Cosine similarity of two vectors; 0 when either is all zeros. */
export function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na > 0 && nb > 0 ? dot / Math.sqrt(na * nb) : 0;
}

/** The words of a question that count for the exact-word bonus: three or more letters, digits or underscores, no stop words. */
export function queryWords(question: string): string[] {
  const words = new Set(question.toLowerCase().match(/[a-z0-9_]{3,}/g) ?? []);
  return [...words].filter((w) => !STOP.has(w));
}

/** EXACT_WEIGHT times the share of `words` that appear as whole words in `text` (case ignored). */
export function exactBonus(words: string[], text: string): number {
  if (words.length === 0) return 0;
  const tokens = new Set(text.toLowerCase().match(/[a-z0-9_]+/g) ?? []);
  const found = words.filter((w) => tokens.has(w)).length;
  return (found / words.length) * EXACT_WEIGHT;
}

/** A stored line read back as a chunk with its vector, or null when any field is missing or of the wrong type. */
export function parseStored(line: string): StoredChunk | null {
  let j: unknown;
  try {
    j = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isObj(j)) return null;
  const ok = typeof j.project === "string" && typeof j.session === "string" && typeof j.time === "string" &&
    typeof j.text === "string" && typeof j.vec === "string" && typeof j.role === "string" && ROLES.has(j.role) &&
    typeof j.line === "number" && Number.isInteger(j.line);
  if (!ok) return null;
  return { project: j.project as string, session: j.session as string, line: j.line as number, time: j.time as string,
    role: j.role as Role, text: j.text as string, vec: j.vec as string };
}

/** The non-empty lines of a text. */
export function linesOf(text: string): string[] {
  return text.split("\n").filter((l) => l.length > 0);
}

/** True when `url` is an http(s) address on loopback only. Anything else is refused: recall sends transcript text to it. */
export function isLoopbackUrl(url: string): boolean {
  return LOOPBACK.test(url);
}
