/**
 * Agent ledger for the mod: one run per finished subagent, folded into monthly and yearly buckets as it ages.
 * State is {runs, buckets} kept in $.store under "ledger". Every field is computed from the transcript, never
 * judged by a model: job and lang come from a `HAIKREW job=<word> lang=<word>` first line, quality is 1/attempts
 * on pass and 0 otherwise. A run's own verdict is whichever of `VERDICT: PASS|FAIL` and `STATUS: done|blocked` comes
 * last in its final message: PASS and done are "pass", FAIL and blocked are "fail", and "none" when neither appears.
 * That self_verdict is a self-report. `verdict` is set only by a checker or reviewer (applyChecked, which also sets
 * checked_by), so a run is judged only when checked_by is set; judged(run) is the one reader of that. Only judged runs
 * (pass or fail) count toward pass rates, track records and routing.
 */
import type { Settings } from "../schema.ts";
import { isObject } from "./api.ts";
import type { Input } from "./api.ts";
import { inferJob } from "./infer.ts";
import type { LiveUsage } from "./crew.ts";
import type { DecisionRecord } from "./decider.ts";
import { normName } from "./names.ts";
import type { LateFields } from "./late.ts";
import { holdPending, prunePending } from "./pending-verdicts.ts";
import type { PendingVerdict, VerdictHold } from "./pending-verdicts.ts";
import { applyDefects } from "./checker.ts";

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
  cache_write: number;
  tokens_estimated: boolean;
  tool_calls: number;
  attempts: number;
  /** The run's own verdict from its final message: "pass", "fail" or "none". A self-report, not a judgement. */
  self_verdict?: string;
  /** A checker's or reviewer's verdict; set only with checked_by. Read it through judged(). */
  verdict?: string;
  quality: number;
  /** The crew display name, set at stop. */
  name?: string;
  /** Who checked it (the reviewer's name) when a checker's verdict replaced the run's own. */
  checked_by?: string;
  /** On a checker's own run: how many of its BROKE entries showed a defect. */
  defects_found?: number;
  /** On a checked run: how many defects its checker found. Absent on runs checked before this was recorded. */
  checker_defects?: number;
  /** On a light run whose checker was skipped by review.checker_skip_after. */
  checker_skipped?: boolean;
  /** How many times the agent was resumed (SendMessage) and its record replaced; the name is kept across them. */
  resumes?: number;
  /** The checker verdict the run had before a resume replaced it; kept from the first resume on. */
  first_checked?: { verdict: string; checked_by: string };
  /** What the decider said about this launch, when it was asked. Folded away with the run by condense(). */
  decision?: DecisionRecord;
  /** The run's changed files split by the edit tool and by the shell, repo-relative like `files`. */
  files_by?: { edit: string[]; shell: string[] };
  /** Changes in the repo during the run that no agent's edits or shell writes explain. Parallel agents share the repo. */
  unattributed?: string[];
} & LateFields;

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
  sum_cache_read: number;
  passes: number;
  fails: number;
};

/** `pending` holds checker verdicts still waiting for their run; see pending-verdicts.ts. */
export type LedgerState = { runs: Run[]; buckets: Bucket[]; pending?: PendingVerdict[] };

/** Fields computed from one subagent transcript. `ended` is the last timestamp, or null. */
export type Transcript = Omit<Run, "ts" | "session" | "agent_id" | "agent_type"> & { ended: string | null; prompt: string };

/** Stats for one (model, job, lang) group, as summary() returns them. */
export type KeyStats = Record<string, string | number>;

const TS_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?Z$/;
const LINE_SPLIT = /\r\n|\r|\n/;
// The text Claude Code writes for a turn the user interrupted; it is not a new attempt.
const INTERRUPT_RE = /^\[Request interrupted by user/;
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
  const text = textBlocks(msg.content);
  if (Array.isArray(msg.content)) {
    msg.content.forEach((block, pos) => {
      if (isObject(block) && block.type === "tool_use") out.tools.add(block.id ? String(block.id) : mid + "#" + pos);
      // Agents may hand their final report back through a SubagentHandback call instead of a text block.
      if (isObject(block) && block.type === "tool_use" && block.name === "SubagentHandback" && isObject(block.input) &&
        typeof block.input.message === "string" && block.input.message.trim()) text.push(block.input.message);
    });
  }
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
      // Tool results have no text block, so they are not turns either.
      const text = textBlocks(msg.content).filter((t) => !INTERRUPT_RE.test(t.trim()));
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

// A `VERDICT: PASS|FAIL for <name>` line is a checker's verdict on someone else's run, so it does not judge this one.
const VERDICT_RE = /VERDICT:\s*(PASS|FAIL)\b(?!\s+for\b)|STATUS:\s*(done|blocked)\b/gi;

/** The verdict the text ends on: the last VERDICT or STATUS marker decides, "none" when there is none. */
function verdict(text: string): string {
  let result = "none";
  for (const m of text.matchAll(VERDICT_RE)) {
    const word = (m[1] ?? m[2] ?? "").toLowerCase();
    result = word === "pass" || word === "done" ? "pass" : "fail";
  }
  return result;
}

/** Fields computed from one subagent transcript given as JSONL text. Missing data yields 0, "unknown" or "none".
 * `prompt` is the first user turn, for inferring a job the spec did not tag. Transcript output counts are the
 * stream-start snapshot, so the result is marked estimated. */
export function parseTranscriptText(text: string): Transcript {
  const s = scan(jsonLines(text));
  const usage = [...s.usage.values()];
  const sumOf = (key: string) => usage.reduce((n, u) => n + count(u, key), 0);
  const attempts = s.turns.length;
  const result = verdict(s.finalText);
  const first = s.turns[0] ?? "";
  const hi = s.times.reduce<number | null>((a, t) => (a === null || t > a ? t : a), null);
  const lo = s.times.reduce<number | null>((a, t) => (a === null || t < a ? t : a), null);
  const cacheWrite = sumOf("cache_creation_input_tokens");
  return {
    model: s.model ?? "unknown",
    job: tag(first, "job"),
    lang: tag(first, "lang"),
    tokens_in: sumOf("input_tokens") + cacheWrite,
    tokens_out: sumOf("output_tokens"),
    cache_read: sumOf("cache_read_input_tokens"),
    cache_write: cacheWrite,
    tokens_estimated: true,
    tool_calls: s.tools.size,
    attempts,
    duration_s: hi !== null && lo !== null ? (hi - lo) / 1000 : 0,
    self_verdict: result,
    quality: result === "pass" ? 1 / Math.max(attempts, 1) : 0,
    ended: hi !== null ? iso(hi) : null,
    prompt: first,
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
  have.sum_cache_read += b.sum_cache_read;
  have.passes += b.passes;
  have.fails += b.fails;
}

/** A one-run bucket for a run, in the period of its timestamp. */
function fromRun(run: Run): Bucket {
  return {
    period: run.ts.slice(0, 7), model: run.model, agent_type: run.agent_type, job: run.job, lang: run.lang,
    n: 1, sum_quality: run.quality, sumsq_quality: run.quality * run.quality,
    sum_tokens_in: run.tokens_in, sum_tokens_out: run.tokens_out, sum_duration: run.duration_s,
    sum_cache_read: run.cache_read,
    passes: outcome(run) === "pass" ? 1 : 0,
    fails: outcome(run) === "fail" ? 1 : 0,
  };
}

/**
 * The verdict a checker or reviewer gave this run ("pass" or "fail"), or null when none did. A run's own final message
 * is only its self_verdict, so pass rates, track records and routing read this. A run that has a verdict but no
 * checked_by was recorded before self-reports were kept apart, and counts as unjudged.
 */
export function judged(run: Pick<Run, "verdict" | "checked_by">): string | null {
  return run.checked_by ? (run.verdict ?? null) : null;
}

/**
 * How a run turned out, for every pass rate, track record, routing and insight: "fail" when a later fix commit flagged
 * it (late_fail), whoever judged it; else the checker's or reviewer's "pass" or "fail"; else null (not judged). The one
 * place that decides; readers count a run as judged exactly when this is not null.
 */
export function outcome(run: Pick<Run, "verdict" | "checked_by"> & { late_fail?: boolean }): "pass" | "fail" | null {
  if (run.late_fail) return "fail";
  const v = judged(run);
  return v === "pass" || v === "fail" ? v : null;
}

/** 'YYYY-MM' of the month `months` before `now` (UTC). */
function monthsBefore(now: Date, months: number): string {
  const idx = now.getUTCFullYear() * 12 + now.getUTCMonth() - months;
  return String(Math.floor(idx / 12)).padStart(4, "0") + "-" + String((idx % 12) + 1).padStart(2, "0");
}

/** The checker's fields on a stored row: its verdict and quality as the checker set them, who checked it, its defects. */
function checkerFields(row: Run): Partial<Run> {
  if (!row.checked_by) return {};
  return {
    verdict: row.verdict,
    quality: row.quality,
    checked_by: row.checked_by,
    ...(row.checker_defects === undefined ? {} : { checker_defects: row.checker_defects }),
  };
}

/**
 * The record that replaces `old` for the same agent. A repeated stop of the same transcript (same end time) keeps the
 * stored row's checker fields and resume count. A real resume takes `run` with the old display name, the resume count
 * raised by one, and the old checker verdict kept as first_checked; its own checker fields start fresh.
 */
function resumed(old: Run, run: Run): Run {
  if (run.ts === old.ts) {
    return {
      ...run,
      ...checkerFields(old),
      name: old.name ?? run.name,
      ...(old.resumes === undefined ? {} : { resumes: old.resumes }),
      ...(old.first_checked ? { first_checked: old.first_checked } : {}),
    };
  }
  const firstChecked = old.first_checked ?? (old.checked_by ? { verdict: old.verdict ?? "none", checked_by: old.checked_by } : undefined);
  return {
    ...run,
    name: old.name ?? run.name,
    resumes: (old.resumes ?? 0) + 1,
    ...(firstChecked ? { first_checked: firstChecked } : {}),
  };
}

/** Append one run, then condense(). */
export function addRun(state: LedgerState, run: Run, settings: Settings): LedgerState {
  // Claude Code can fire SubagentStop more than once for one agent, and SendMessage resumes a finished one; the later
  // record replaces the earlier one.
  const old = run.agent_id ? state.runs.find((r) => r.agent_id === run.agent_id) : undefined;
  const runs = run.agent_id ? state.runs.filter((r) => r.agent_id !== run.agent_id) : state.runs;
  const pending = prunePending(state.pending ?? [], new Date());
  const next = old ? resumed(old, run) : run;
  return condense(applyHeld({ runs: [...runs, next], buckets: state.buckets, pending }), settings);
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
  return { ...state, runs: state.runs.filter((_, idx) => kept.has(idx)), buckets: [...yearly.values()] };
}

/**
 * {recent: newest 50 runs, by_key: stats per (model, job, lang) merged across runs and buckets}. A group's mean output
 * is over its live-counted runs when it has any, else over all of its runs.
 */
export function summary(state: LedgerState): { recent: Run[]; by_key: KeyStats[] } {
  const recent = state.runs.map((run, idx) => ({ run, idx })).sort((a, b) =>
    (a.run.ts < b.run.ts ? 1 : a.run.ts > b.run.ts ? -1 : b.idx - a.idx))
    .slice(0, RECENT).map((x) => x.run);
  const groups = new Map<string, Bucket>();
  const parts = [...state.runs.map(fromRun), ...state.buckets];
  for (const b of parts) mergeInto(groups, groupKey(b), { ...b, period: "", agent_type: "" });
  const counts = outputCounts(state.runs);
  const rows = [...groups.entries()].sort(([, a], [, b]) =>
    b.n - a.n || cmp(a.model, b.model) || cmp(a.job, b.job) || cmp(a.lang, b.lang));
  return { recent, by_key: rows.map(([key, b]) => keyStats(b, counts.get(key))) };
}

function groupKey(b: Pick<Bucket, "model" | "job" | "lang">): string {
  return JSON.stringify([b.model, b.job, b.lang]);
}

/** One group's output over its kept runs: the live-counted runs' output sum and count, and how many runs were
 * transcript-counted. */
type OutputCounts = { live_sum: number; live_n: number; estimated_runs: number };

function outputCounts(runs: Run[]): Map<string, OutputCounts> {
  const out = new Map<string, OutputCounts>();
  for (const r of runs) {
    const key = groupKey(r);
    const acc = out.get(key) ?? { live_sum: 0, live_n: 0, estimated_runs: 0 };
    if (r.tokens_estimated) {
      acc.estimated_runs += 1;
    } else {
      acc.live_sum += r.tokens_out;
      acc.live_n += 1;
    }
    out.set(key, acc);
  }
  return out;
}

/** One model's token and run totals. `estimated_runs` counts the kept runs whose tokens came from a transcript, so
 * their output is a lower bound; folded buckets do not record that and count as none. */
export type ModelTokens = { tokens_in: number; tokens_out: number; cache_read: number; runs: number; estimated_runs: number };

/** Tokens in, tokens out, cache reads, run count and estimated run count per model, summed over the kept runs and the
 * monthly and yearly buckets. */
export function tokenTotals(state: LedgerState): Record<string, ModelTokens> {
  const out: Record<string, ModelTokens> = {};
  const add = (model: string, t: ModelTokens): void => {
    const acc = (out[model] ??= { tokens_in: 0, tokens_out: 0, cache_read: 0, runs: 0, estimated_runs: 0 });
    acc.tokens_in += t.tokens_in;
    acc.tokens_out += t.tokens_out;
    acc.cache_read += t.cache_read;
    acc.runs += t.runs;
    acc.estimated_runs += t.estimated_runs;
  };
  for (const run of state.runs) {
    add(run.model, { tokens_in: run.tokens_in, tokens_out: run.tokens_out, cache_read: run.cache_read, runs: 1,
      estimated_runs: run.tokens_estimated ? 1 : 0 });
  }
  for (const b of state.buckets) {
    add(b.model, { tokens_in: b.sum_tokens_in, tokens_out: b.sum_tokens_out, cache_read: b.sum_cache_read, runs: b.n,
      estimated_runs: 0 });
  }
  return out;
}

/** One model's totals across its groups: runs, judged runs, pass rate over the judged ones, mean tokens (in plus out)
 * and seconds per run, and how many runs had transcript-counted tokens. */
export type ModelStats = { model: string; n: number; judged: number; pass_rate: number; tokens_mean: number; duration_mean: number;
  estimated_runs: number };

/** Per-model stats from summary()'s groups. Tokens and seconds are weighted by each group's runs, the pass rate by
 * its judged runs; most runs first. */
export function byModel(groups: KeyStats[]): ModelStats[] {
  const out = new Map<string, ModelStats>();
  for (const g of groups) {
    const n = Number(g.n);
    const judged = Number(g.judged);
    const m = out.get(String(g.model)) ??
      { model: String(g.model), n: 0, judged: 0, pass_rate: 0, tokens_mean: 0, duration_mean: 0, estimated_runs: 0 };
    m.n += n;
    m.judged += judged;
    m.pass_rate += Number(g.pass_rate) * judged; // the group's passes, divided by judged below
    m.tokens_mean += (Number(g.tokens_in_mean) + Number(g.tokens_out_mean)) * n;
    m.duration_mean += Number(g.duration_mean) * n;
    m.estimated_runs += Number(g.estimated_runs ?? 0);
    out.set(m.model, m);
  }
  return [...out.values()].filter((m) => m.n > 0).map((m) => ({
    ...m, pass_rate: m.judged > 0 ? m.pass_rate / m.judged : 0,
    tokens_mean: m.tokens_mean / m.n, duration_mean: m.duration_mean / m.n,
  })).sort((a, b) => b.n - a.n || cmp(a.model, b.model));
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Stats for one group. `n` counts every run; pass_rate is over the judged runs (passes plus fails) only. Stdev is
 * the sample stdev. Mean output is over the live-counted runs when there are any (counts), else over all of them. */
function keyStats(b: Bucket, counts?: OutputCounts): KeyStats {
  const n = b.n;
  const judged = b.passes + b.fails;
  const variance = n > 1 ? (b.sumsq_quality - (b.sum_quality * b.sum_quality) / n) / (n - 1) : 0;
  const outMean = counts && counts.live_n > 0 ? counts.live_sum / counts.live_n : b.sum_tokens_out / n;
  return {
    model: b.model, job: b.job, lang: b.lang, n, judged,
    quality_mean: b.sum_quality / n,
    quality_stdev: Math.sqrt(Math.max(variance, 0)),
    pass_rate: judged > 0 ? b.passes / judged : 0,
    tokens_in_mean: b.sum_tokens_in / n,
    tokens_out_mean: outMean,
    estimated_runs: counts?.estimated_runs ?? 0,
    duration_mean: b.sum_duration / n,
  };
}

/** The stored ledger state, or an empty one when the stored value is not a ledger. Fields that older ledgers lack
 * get their defaults here, so the rest of the module sees complete records. */
export function readState(value: unknown): LedgerState {
  if (isObject(value) && Array.isArray(value.runs) && Array.isArray(value.buckets)) {
    return {
      ...(Array.isArray(value.pending) ? { pending: value.pending as PendingVerdict[] } : {}),
      runs: (value.runs as Run[]).map(storedRun),
      buckets: (value.buckets as Bucket[]).map((b) => ({
        // A bucket folded before fails were counted judged nothing reliably: its passes count as unjudged too.
        ...b, passes: b.fails === undefined ? 0 : b.passes, fails: b.fails ?? 0, sum_cache_read: b.sum_cache_read ?? 0,
      })),
    };
  }
  return { runs: [], buckets: [] };
}

/** A stored run with cache writes 0 and tokens estimated when absent, and the retired "blocked" verdict as "fail". */
function storedRun(r: Run): Run {
  // Before self_verdict, a run's own verdict was stored as verdict. A checked run's own verdict was overwritten, so "none".
  const own = r.self_verdict ?? (r.checked_by ? "none" : r.verdict ?? "none");
  return {
    ...r,
    self_verdict: own === "blocked" ? "fail" : own,
    cache_write: r.cache_write ?? 0,
    tokens_estimated: r.tokens_estimated ?? true,
    verdict: r.verdict === "blocked" ? "fail" : r.verdict,
  };
}

/** One run from a SubagentStop event and the subagent's transcript text. */
export function runFromStop(e: Input, transcript: string): Run {
  const { ended, prompt, ...info } = parseTranscriptText(transcript);
  const agentType = String(e.agent_type || "unknown");
  return {
    ...info,
    job: info.job === "unknown" ? inferJob(prompt, agentType) : info.job,
    ts: ended ?? iso(Date.now()),
    session: String(e.session_id || ""),
    agent_id: String(e.agent_id || ""),
    agent_type: agentType,
  };
}

/** A run whose tokens were counted live, not read from the transcript. Cache writes count toward tokens in. */
export function withLiveUsage(run: Run, live: { input: number; cacheWrite: number; cacheRead: number; output: number }): Run {
  return {
    ...run,
    tokens_in: live.input + live.cacheWrite,
    cache_write: live.cacheWrite,
    cache_read: live.cacheRead,
    tokens_out: live.output,
    tokens_estimated: false,
  };
}

/**
 * A run with its live usage where the transcript saw more input than the live count did, as when a resumed agent's
 * earlier steps came before this session counted them. Each input-side field keeps the larger of the two, and output
 * keeps the larger too. Otherwise the run is withLiveUsage's. Tokens in come from the transcript here, so the counts
 * are estimated.
 */
export function combineUsage(parsed: Run, live: LiveUsage): Run {
  const liveIn = live.input + live.cacheWrite;
  if (parsed.tokens_in <= liveIn) return withLiveUsage(parsed, live);
  return {
    ...parsed,
    tokens_in: Math.max(liveIn, parsed.tokens_in),
    cache_write: Math.max(live.cacheWrite, parsed.cache_write),
    cache_read: Math.max(live.cacheRead, parsed.cache_read),
    tokens_out: Math.max(live.output, parsed.tokens_out),
    tokens_estimated: true,
  };
}

/** The run with verdict, quality, attempts and input-side tokens re-read from its transcript. Output tokens are
 * re-read only when the run's tokens were not counted live, since the transcript's output count is a snapshot. */
export function rescanRun(run: Run, transcript: string): Run {
  const t = parseTranscriptText(transcript);
  const live = run.tokens_estimated === false;
  return {
    ...run,
    // A reviewer's verdict (checked_by) outranks the agent's own.
    ...(run.checked_by ? {} : { self_verdict: t.self_verdict, quality: t.quality }),
    attempts: t.attempts,
    // A live-counted run keeps all its token counts; only a transcript-counted one takes the re-read ones.
    ...(live ? {} : { tokens_in: t.tokens_in, cache_write: t.cache_write, cache_read: t.cache_read, tokens_out: t.tokens_out }),
    tokens_estimated: !live,
  };
}

/**
 * The stored ledger with each rescanned run in place of the stored run that has its agent id. A stored run that was not
 * rescanned, and any run stored since the rescan read it, stay as they are.
 */
export function mergeRescanned(current: LedgerState, rescanned: Run[]): LedgerState {
  const byAgent = new Map<string, Run>(rescanned.filter((r) => r.agent_id !== "").map((r) => [r.agent_id, r]));
  return { ...current, runs: current.runs.map((r) => byAgent.get(r.agent_id) ?? r) };
}

/** The final assistant text of a subagent transcript (JSONL text): its report. */
export function finalReport(transcript: string): string {
  return scan(jsonLines(transcript)).finalText;
}

const CHECKER_RE = /VERDICT:\s*(PASS|FAIL)\s+for\s+([^\r\n]+)/gi;

/** The last `VERDICT: PASS|FAIL for <name>` line of a checker's report, or null. The name is normName'd. */
export function parseCheckerVerdict(text: string): { verdict: "pass" | "fail"; name: string } | null {
  let found: { verdict: "pass" | "fail"; name: string } | null = null;
  for (const m of text.matchAll(CHECKER_RE)) {
    const name = normName((m[2] ?? "").replace(/[*`]/g, ""));
    if (name) found = { verdict: (m[1] ?? "").toLowerCase() === "pass" ? "pass" : "fail", name };
  }
  return found;
}

/**
 * The state with the newest run matching `target` (by agent id, else by name) given the checker's verdict: pass is
 * quality 1/attempts, fail 0. Unchanged when no run matches.
 */
export function applyChecked(state: LedgerState, target: { agentId?: string; name?: string }, verdict: "pass" | "fail", checker: string): LedgerState {
  const want = target.name ? normName(target.name) : "";
  const hit = (r: Run): boolean => (target.agentId ? r.agent_id === target.agentId : !!want && normName(r.name ?? "") === want);
  let at = -1;
  state.runs.forEach((r, i) => {
    if (hit(r) && (at < 0 || r.ts >= (state.runs[at]?.ts ?? ""))) at = i;
  });
  if (at < 0) return state;
  const runs = state.runs.map((r, i) => i !== at ? r
    : { ...r, verdict, quality: verdict === "pass" ? 1 / Math.max(r.attempts, 1) : 0, checked_by: checker });
  return { ...state, runs };
}

/**
 * applyChecked, or when no run carries the name yet, the verdict (and its defect count) is held as pending until a run
 * with that name is added. Use this for a checker's VERDICT line, which can be read before its run is ledgered.
 */
export function applyOrHold(state: LedgerState, hold: VerdictHold, now: Date = new Date()): LedgerState {
  const next = applyChecked(state, { name: hold.name }, hold.verdict, hold.checker);
  if (next !== state) return next;
  return { ...state, pending: holdPending(state.pending ?? [], hold, now) };
}

/** The state with each held verdict applied as applyChecked applies it, to the newest run its name matches, and its
 * defect count stored on that run as applyDefects does unless the run has one. Verdicts that match no run stay pending. */
function applyHeld(state: LedgerState): LedgerState {
  const still: PendingVerdict[] = [];
  let next: LedgerState = state;
  for (const h of state.pending ?? []) {
    const applied = applyChecked(next, { name: h.name }, h.verdict, h.checker);
    if (applied === next) {
      still.push(h);
      continue;
    }
    const at = applied.runs.findIndex((r, i) => r !== next.runs[i]);
    const counts = h.defects !== undefined && applied.runs[at]?.checker_defects === undefined;
    next = counts ? applyDefects(applied, { checkerId: "", checkedName: h.name }, h.defects ?? 0) : applied;
  }
  return { ...next, pending: still };
}
