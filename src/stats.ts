/**
 * Token use per model, read from Claude Code transcripts: every *.jsonl under the projects root,
 * subagent transcripts included. HAIKREW_TRANSCRIPTS overrides ~/.claude/projects (used by tests).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** A parsed JSON object (transcript line). */
type Json = Record<string, unknown>;

/** Token totals and assistant message count for one model. */
export type ModelTotals = {
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
  messages: number;
};

const DAY_MS = 86_400_000;
const TS_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?Z$/;
const LINE_SPLIT = /\r\n|\r|\n/;
const USAGE_FIELDS: [Exclude<keyof ModelTotals, "messages">, string][] = [
  ["input", "input_tokens"],
  ["output", "output_tokens"],
  ["cache_read", "cache_read_input_tokens"],
  ["cache_write", "cache_creation_input_tokens"],
];

function root(): string {
  return process.env.HAIKREW_TRANSCRIPTS || join(homedir(), ".claude", "projects");
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) ? value : 0;
}

function isObj(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** UTC Date for a transcript timestamp such as 2026-10-08T09:00:00.000Z, or null when it does not parse. */
function parseTs(value: unknown): Date | null {
  const m = typeof value === "string" ? TS_RE.exec(value) : null;
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1, 7).map(Number);
  const ms = Number(((m[7] ?? "") + "00").slice(0, 3));
  const when = new Date(0);
  when.setUTCFullYear(y, mo - 1, d);
  when.setUTCHours(h, mi, s, ms);
  const exact = when.getUTCFullYear() === y && when.getUTCMonth() === mo - 1 && when.getUTCDate() === d
    && when.getUTCHours() === h && when.getUTCMinutes() === mi && when.getUTCSeconds() === s;
  return exact ? when : null;
}

/** Parsed JSON objects from a JSONL file. Unreadable files and unparseable lines are skipped. */
function readJsonl(path: string): Json[] {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const out: Json[] = [];
  for (const line of text.split(LINE_SPLIT)) {
    try {
      const obj: unknown = JSON.parse(line);
      if (isObj(obj)) out.push(obj);
    } catch {
      // A partly written line is skipped.
    }
  }
  return out;
}

/** Paths of every *.jsonl file under `dir`, recursively. A missing directory gives []. */
function listJsonl(dir: string): string[] {
  let names: string[];
  try {
    names = readdirSync(dir, { recursive: true }) as string[];
  } catch {
    return [];
  }
  return names
    .filter((name) => name.endsWith(".jsonl"))
    .map((name) => join(dir, name))
    .filter((path) => statSync(path, { throwIfNoEntry: false })?.isFile());
}

/** Keep the newest usage seen for each assistant message id whose timestamp is inside the window. */
function remember(seen: Map<string, [string, Json]>, entry: Json, cutoff: number): void {
  const msg = entry.message;
  if (entry.type !== "assistant" || !isObj(msg) || !isObj(msg.usage)) return;
  const when = parseTs(entry.timestamp);
  if (!when || when.getTime() < cutoff) return;
  const key = typeof msg.id === "string" && msg.id ? msg.id : `anonymous-${seen.size}`;
  seen.set(key, [typeof msg.model === "string" && msg.model ? msg.model : "unknown", msg.usage]);
}

/** {model: totals} for assistant messages with a timestamp in the last `days` days. Each message.id is
 * counted once, since transcripts repeat streamed messages. Empty when the root is missing. */
export function totals(days = 7): Record<string, ModelTotals> {
  const cutoff = Date.now() - days * DAY_MS;
  const seen = new Map<string, [string, Json]>();
  for (const path of listJsonl(root())) {
    for (const entry of readJsonl(path)) remember(seen, entry, cutoff);
  }
  const out = new Map<string, ModelTotals>();
  for (const [model, usage] of seen.values()) {
    let row = out.get(model);
    if (!row) {
      row = { input: 0, output: 0, cache_read: 0, cache_write: 0, messages: 0 };
      out.set(model, row);
    }
    row.messages += 1;
    for (const [key, field] of USAGE_FIELDS) row[key] += count(usage[field]);
  }
  return Object.fromEntries(out);
}
