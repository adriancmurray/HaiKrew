/**
 * Agent ledger for the mod: one run per finished subagent, folded into monthly and yearly buckets as it ages.
 * State is {runs, buckets} kept in $.store under "ledger". Every field is computed from the transcript, never
 * judged by a model: job and lang come from a `HAIKREW job=<word> lang=<word>` first line, verdict from the
 * last `VERDICT: PASS|FAIL` (or `STATUS: blocked`), quality is 1/attempts on pass and 0 otherwise.
 */
import type { Settings } from "../schema.ts";
import { isObject } from "./api.ts";
import type { Input } from "./api.ts";

/** One finished subagent. */
export type Run = {
  ts: string;
  session: string;
  agent_id: string;
  agent_type: string;
  model: string;
  job: string;
  lang: string;
  duration_s: number;
  tokens_in: number;
  tokens_out: number;
  cache_read: number;
  tool_calls: number;
  attempts: number;
  verdict: string;
  quality: number;
};

/** Sums of runs for one (period, model, agent_type, job, lang); period is 'YYYY-MM', 'YYYY', or ''. */
export type Bucket = {
  period: string;
  model: string;
  agent_type: string;
  job: string;
  lang: string;
  n: number;
  sum_quality: number;
  sumsq_quality: number;
  sum_tokens_in: number;
  sum_tokens_out: number;
  sum_duration: number;
  passes: number;
};

export type LedgerState = { runs: Run[]; buckets: Bucket[] };

/** Fields computed from one subagent transcript. `ended` is the last timestamp, or null. */
export type Transcript = Omit<Run, "ts" | "session" | "agent_id" | "agent_type"> & { ended: string | null };

/** Stats for one (model, job, lang) group, as summary() returns them. */
export type KeyStats = Record<string, string | number>;

const TS_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?Z$/;
const LINE_SPLIT = /\r\n|\r|\n/;
const RECENT = 50;

type Scan = {
  turns: string[];
  usage: Map<string, Record<string, unknown>>;
  tools: Set<string>;
  model: string | null;
  times: number[];
  finalText: string;
};

/** UTC epoch milliseconds for a transcript timestamp such as 2026-10-08T09:00:00.000Z, or null. */
function parseTs(value: unknown): number | null {
  const m = typeof value === "string" ? TS_RE.exec(value) : null;
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1, 7).map(Number);
  return Date.UTC(y, mo - 1, d, h, mi, s, Number(((m[7] ?? "") + "00").slice(0, 3)));
}

function iso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19) + "Z";
}

function textBlocks(content: unknown): string[] {
  let raw: unknown[];
  if (typeof content === "string") raw = [content];
  else if (Array.isArray(content)) raw = content.map((b) => (isObject(b) && b.type === "text" ? b.text : undefined));
  else raw = [];
  return raw.filter((t): t is string => typeof t === "string" && t.trim() !== "");
}

function count(usage: Record<string, unknown>, key: string): number {
  const value = usage[key];
  return typeof value === "number" && Number.isInteger(value) ? value : 0;
}

function scanAssistant(out: Scan, msg: Record<string, unknown>, idx: number): void {
  const mid = msg.id ? String(msg.id) : String(idx); // real ids are never bare digits
  if (isObject(msg.usage)) out.usage.set(mid, msg.usage);
  if (!out.model && typeof msg.model === "string" && msg.model) out.model = msg.model;
  if (Array.isArray(msg.content)) {
    msg.content.forEach((block, pos) => {
      if (isObject(block) && block.type === "tool_use") out.tools.add(block.id ? String(block.id) : mid + "#" + pos);
    });
  }
  const text = textBlocks(msg.content);
  if (text.length) out.finalText = text.join("\n");
}

/** One pass over transcript objects: user turn texts, assistant usage, tool calls, model, timestamps, and the
 * text of the last assistant message that has text. */
function scan(entries: Record<string, unknown>[]): Scan {
  const out: Scan = { turns: [], usage: new Map(), tools: new Set(), model: null, times: [], finalText: "" };
  entries.forEach((entry, idx) => {
    const when = parseTs(entry.timestamp);
    if (when !== null) out.times.push(when);
    const msg = isObject(entry.message) ? entry.message : {};
    if (entry.type === "user" && !entry.isMeta) {
      const text = textBlocks(msg.content);
      if (text.length) out.turns.push(text.join("\n"));
    } else if (entry.type === "assistant") {
      scanAssistant(out, msg, idx);
    }
  });
  return out;
}

/** Parsed JSON objects from JSONL text. Lines that are not JSON objects are skipped. */
function jsonLines(text: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const line of text.split(LINE_SPLIT)) {
    try {
      const obj: unknown = JSON.parse(line);
      if (isObject(obj)) out.push(obj);
    } catch {
      // A partly written line is skipped.
    }
  }
  return out;
}

function tag(prompt: string, name: string): string {
  const first = (prompt.trim().split(LINE_SPLIT)[0] ?? "").trim();
  if (!first.startsWith("HAIKREW")) return "unknown";
  const word = first.split(/\s+/).find((w) => w.startsWith(name + "="));
  const value = /^[\w.-]+/.exec(word ? word.slice(name.length + 1) : "");
  return value ? value[0] : "unknown";
}

function verdict(text: string): string {
  if (/STATUS:\s*blocked\b/i.test(text)) return "blocked";
  const found = [...text.matchAll(/VERDICT:\s*(PASS|FAIL)\b/g)];
  return found.length ? found[found.length - 1][1].toLowerCase() : "none";
}

/** Fields computed from one subagent transcript given as JSONL text. Missing data yields 0, "unknown" or "none". */
export function parseTranscriptText(text: string): Transcript {
  const s = scan(jsonLines(text));
  const usage = [...s.usage.values()];
  const sumOf = (key: string) => usage.reduce((n, u) => n + count(u, key), 0);
  const attempts = s.turns.length;
  const result = verdict(s.finalText);
  const first = s.turns[0] ?? "";
  const hi = s.times.reduce<number | null>((a, t) => (a === null || t > a ? t : a), null);
  const lo = s.times.reduce<number | null>((a, t) => (a === null || t < a ? t : a), null);
  return {
    model: s.model ?? "unknown",
    job: tag(first, "job"),
    lang: tag(first, "lang"),
    tokens_in: sumOf("input_tokens"),
    tokens_out: sumOf("output_tokens"),
    cache_read: sumOf("cache_read_input_tokens"),
    tool_calls: s.tools.size,
    attempts,
    duration_s: hi !== null && lo !== null ? (hi - lo) / 1000 : 0,
    verdict: result,
    quality: result === "pass" ? 1 / Math.max(attempts, 1) : 0,
    ended: hi !== null ? iso(hi) : null,
  };
}

function bucketKey(parts: Bucket): string {
  return JSON.stringify([parts.period, parts.model, parts.agent_type, parts.job, parts.lang]);
}

/** Add b's sums into the bucket stored under key, creating it when absent. */
function mergeInto(map: Map<string, Bucket>, key: string, b: Bucket): void {
  const have = map.get(key);
  if (!have) {
    map.set(key, { ...b });
    return;
  }
  have.n += b.n;
  have.sum_quality += b.sum_quality;
  have.sumsq_quality += b.sumsq_quality;
  have.sum_tokens_in += b.sum_tokens_in;
  have.sum_tokens_out += b.sum_tokens_out;
  have.sum_duration += b.sum_duration;
  have.passes += b.passes;
}

/** A one-run bucket for a run, in the period of its timestamp. */
function fromRun(run: Run): Bucket {
  return {
    period: run.ts.slice(0, 7), model: run.model, agent_type: run.agent_type, job: run.job, lang: run.lang,
    n: 1, sum_quality: run.quality, sumsq_quality: run.quality * run.quality,
    sum_tokens_in: run.tokens_in, sum_tokens_out: run.tokens_out, sum_duration: run.duration_s,
    passes: run.verdict === "pass" ? 1 : 0,
  };
}

/** 'YYYY-MM' of the month `months` before `now` (UTC). */
function monthsBefore(now: Date, months: number): string {
  const idx = now.getUTCFullYear() * 12 + now.getUTCMonth() - months;
  return String(Math.floor(idx / 12)).padStart(4, "0") + "-" + String((idx % 12) + 1).padStart(2, "0");
}

/** Append one run, then condense(). */
export function addRun(state: LedgerState, run: Run, settings: Settings): LedgerState {
  // Claude Code can fire SubagentStop more than once for one agent; the later record replaces the earlier one.
  const runs = run.agent_id ? state.runs.filter((r) => r.agent_id !== run.agent_id) : state.runs;
  return condense({ runs: [...runs, run], buckets: state.buckets }, settings);
}

/** Keep the newest ledger.raw_limit runs. Fold older runs into monthly buckets, and monthly buckets older than
 * ledger.yearly_after_months into yearly ones. Idempotent. `now` is injectable for tests. */
export function condense(state: LedgerState, settings: Settings, now: Date = new Date()): LedgerState {
  const rawLimit = Number(settings.ledger.raw_limit);
  const cutoff = monthsBefore(now, Number(settings.ledger.yearly_after_months));
  const order = state.runs.map((run, idx) => ({ run, idx })).sort((a, b) =>
    (a.run.ts < b.run.ts ? 1 : a.run.ts > b.run.ts ? -1 : b.idx - a.idx));
  const kept = new Set(order.slice(0, rawLimit).map((x) => x.idx));
  const monthly = new Map<string, Bucket>();
  for (const b of state.buckets) mergeInto(monthly, bucketKey(b), b);
  state.runs.forEach((run, idx) => {
    if (!kept.has(idx)) mergeInto(monthly, bucketKey(fromRun(run)), fromRun(run));
  });
  const yearly = new Map<string, Bucket>();
  for (const b of monthly.values()) {
    const folded = b.period.length === 7 && b.period < cutoff ? { ...b, period: b.period.slice(0, 4) } : b;
    mergeInto(yearly, bucketKey(folded), folded);
  }
  return {
    runs: state.runs.filter((_, idx) => kept.has(idx)),
    buckets: [...yearly.values()],
  };
}

/** {recent: newest 50 runs, by_key: stats per (model, job, lang) merged across runs and buckets}. */
export function summary(state: LedgerState): { recent: Run[]; by_key: KeyStats[] } {
  const recent = state.runs.map((run, idx) => ({ run, idx })).sort((a, b) =>
    (a.run.ts < b.run.ts ? 1 : a.run.ts > b.run.ts ? -1 : b.idx - a.idx))
    .slice(0, RECENT).map((x) => x.run);
  const groups = new Map<string, Bucket>();
  const parts = [...state.runs.map(fromRun), ...state.buckets];
  for (const b of parts) mergeInto(groups, JSON.stringify([b.model, b.job, b.lang]), { ...b, period: "", agent_type: "" });
  const rows = [...groups.values()].sort((a, b) =>
    b.n - a.n || cmp(a.model, b.model) || cmp(a.job, b.job) || cmp(a.lang, b.lang));
  return { recent, by_key: rows.map(keyStats) };
}

/** Tokens in, tokens out and run count per model, summed over the kept runs and the monthly and yearly buckets. */
export function tokenTotals(state: LedgerState): Record<string, { tokens_in: number; tokens_out: number; runs: number }> {
  const out: Record<string, { tokens_in: number; tokens_out: number; runs: number }> = {};
  const add = (model: string, tokensIn: number, tokensOut: number, runs: number): void => {
    const t = (out[model] ??= { tokens_in: 0, tokens_out: 0, runs: 0 });
    t.tokens_in += tokensIn;
    t.tokens_out += tokensOut;
    t.runs += runs;
  };
  for (const run of state.runs) add(run.model, run.tokens_in, run.tokens_out, 1);
  for (const b of state.buckets) add(b.model, b.sum_tokens_in, b.sum_tokens_out, b.n);
  return out;
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Stats for one group. Stdev is the sample stdev. */
function keyStats(b: Bucket): KeyStats {
  const n = b.n;
  const variance = n > 1 ? (b.sumsq_quality - (b.sum_quality * b.sum_quality) / n) / (n - 1) : 0;
  return {
    model: b.model, job: b.job, lang: b.lang, n,
    quality_mean: b.sum_quality / n,
    quality_stdev: Math.sqrt(Math.max(variance, 0)),
    pass_rate: b.passes / n,
    tokens_in_mean: b.sum_tokens_in / n,
    tokens_out_mean: b.sum_tokens_out / n,
    duration_mean: b.sum_duration / n,
  };
}

/** A gate rule the pane offers to add, with the line that explains it. */
export type Suggestion = { rule: string; text: string };

const SUGGEST_MIN_RUNS = 4;
const SUGGEST_PASS_BELOW = 0.6;

/** 'haiku', 'sonnet' or 'opus' when the model name contains one, else ''. */
function family(model: string): string {
  return ["haiku", "sonnet", "opus"].find((f) => model.toLowerCase().includes(f)) ?? "";
}

/** Rules that move a group up one model when it passes poorly: Haiku to Sonnet, Sonnet to Opus. Groups with fewer
 * than four runs are not judged. A rule is skipped when a current rule already starts with its selector. Writes nothing. */
export function suggestions(state: LedgerState, rules: string[]): Suggestion[] {
  const out: Suggestion[] = [];
  for (const r of summary(state).by_key) {
    const n = Number(r.n);
    const job = String(r.job);
    const lang = String(r.lang);
    const fam = family(String(r.model));
    const next = fam === "haiku" ? "sonnet" : fam === "sonnet" ? "opus" : "";
    if (n < SUGGEST_MIN_RUNS || Number(r.pass_rate) >= SUGGEST_PASS_BELOW || job === "" || job === "unknown" || next === "") continue;
    const selector = "job:" + job + (lang && lang !== "unknown" ? "+lang:" + lang : "");
    if (rules.some((rule) => rule.slice(0, rule.lastIndexOf("=")) === selector)) continue;
    const pct = Math.round(Number(r.pass_rate) * 100);
    const rule = selector + "=" + next;
    out.push({
      rule,
      text: job + " " + (lang && lang !== "unknown" ? lang + " " : "") + "on " + capitalize(fam) + ": " + n + " runs, " + pct + "% pass; suggest " + rule,
    });
  }
  return out;
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** The stored ledger state, or an empty one when the stored value is not a ledger. */
export function readState(value: unknown): LedgerState {
  if (isObject(value) && Array.isArray(value.runs) && Array.isArray(value.buckets)) {
    return value as unknown as LedgerState;
  }
  return { runs: [], buckets: [] };
}

/** One run from a SubagentStop event and the subagent's transcript text. */
export function runFromStop(e: Input, transcript: string): Run {
  const { ended, ...info } = parseTranscriptText(transcript);
  return {
    ...info,
    ts: ended ?? iso(Date.now()),
    session: String(e.session_id || ""),
    agent_id: String(e.agent_id || ""),
    agent_type: String(e.agent_type || "unknown"),
  };
}
