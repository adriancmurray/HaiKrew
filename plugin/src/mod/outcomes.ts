/**
 * Routing outcomes from the ledger's runs: how each (model, job, language, size) group has done, with the measures the
 * track record does not show: checked results, late failures, escalations and paid tokens per accepted result. Pure.
 * Every number is counted from the runs; nothing is estimated. Only the runs the ledger keeps raw are counted.
 */
import { modelFamily } from "./crew.ts";
import type { Run } from "./ledger.ts";

/** Models cheapest first: the order a routing rule should try them in. */
export const MODEL_ORDER = ["haiku", "sonnet", "opus"];

/** A model's place in MODEL_ORDER, or -1 for a model that is not one of the three. */
export function rankOf(model: string): number {
  return MODEL_ORDER.indexOf(model);
}

/**
 * One (model, job, language, size) group. Rates are null when nothing in the group was judged. `paid_tokens` is the
 * input plus output of Sonnet and Opus runs, which is what routing spends; Haiku's go in `haiku_tokens` and not in the
 * headline. `paid_tokens_per_accepted` is null for Haiku and for a group with no accepted result.
 */
export type OutcomeRow = {
  model: string; job: string; lang: string; size_level: string;
  runs: number; judged: number; passed: number; pass_rate: number | null;
  checked: number; checked_pass_rate: number | null;
  late_fail: number; escalations: number;
  paid_tokens: number; haiku_tokens: number; paid_tokens_per_accepted: number | null;
};

/** A run flagged as a late failure. Older ledgers have no such field, so it reads as false there. */
export function lateFailed(run: Run): boolean {
  return Boolean((run as Run & { late_fail?: unknown }).late_fail);
}

/** The decider's size estimate for the run, or "" when the decider did not give one. */
function sizeOf(run: Run): string {
  const size = (run as Run & { decision?: { features?: { size_level?: unknown } } }).decision?.features?.size_level;
  return typeof size === "string" ? size : "";
}

/**
 * The runs that were re-run on a bigger model. A run counts when a later run with the same crew name and job used a
 * bigger model. This is an approximation: a crew name is reused across unrelated launches, so it marks likely retries.
 */
function escalatedRuns(runs: Run[]): Set<Run> {
  const byName = new Map<string, Run[]>();
  for (const run of runs) {
    if (!run.name || rankOf(modelFamily(run.model)) < 0) continue;
    const key = JSON.stringify([run.name, run.job]);
    byName.set(key, [...(byName.get(key) ?? []), run]);
  }
  const out = new Set<Run>();
  for (const list of byName.values()) {
    list.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
    // Walk from the newest back, keeping the biggest rank seen so far among the later runs.
    let biggestLater = -1;
    for (let i = list.length - 1; i >= 0; i--) {
      const run = list[i];
      const rank = rankOf(modelFamily(run.model));
      if (biggestLater > rank) out.add(run);
      biggestLater = Math.max(biggestLater, rank);
    }
  }
  return out;
}

type Tally = {
  runs: number; judged: number; passed: number; checked: number; checkedJudged: number; checkedPassed: number;
  late: number; escalations: number; paid: number; haiku: number;
};

function addRun(t: Tally, run: Run, escalated: boolean): void {
  const judged = run.verdict === "pass" || run.verdict === "fail";
  const passed = run.verdict === "pass";
  t.runs += 1;
  if (judged) {
    t.judged += 1;
    if (passed) t.passed += 1;
  }
  if (run.checked_by) {
    t.checked += 1;
    if (judged) {
      t.checkedJudged += 1;
      if (passed) t.checkedPassed += 1;
    }
  }
  if (lateFailed(run)) t.late += 1;
  if (escalated) t.escalations += 1;
  const family = modelFamily(run.model);
  const tokens = run.tokens_in + run.tokens_out;
  if (family === "sonnet" || family === "opus") t.paid += tokens;
  else if (family === "haiku") t.haiku += tokens;
}

function ratio(n: number, d: number): number | null {
  return d > 0 ? n / d : null;
}

function rowOf(key: string[], t: Tally): OutcomeRow {
  const [model, job, lang, size_level] = key;
  const paid = model === "sonnet" || model === "opus";
  return {
    model, job, lang, size_level, runs: t.runs, judged: t.judged, passed: t.passed, pass_rate: ratio(t.passed, t.judged),
    checked: t.checked, checked_pass_rate: ratio(t.checkedPassed, t.checkedJudged), late_fail: t.late, escalations: t.escalations,
    paid_tokens: t.paid, haiku_tokens: t.haiku,
    paid_tokens_per_accepted: paid ? ratio(t.paid, t.passed) : null,
  };
}

function emptyTally(): Tally {
  return { runs: 0, judged: 0, passed: 0, checked: 0, checkedJudged: 0, checkedPassed: 0, late: 0, escalations: 0, paid: 0, haiku: 0 };
}

function text(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Outcome rows grouped by model, job, language and size level (the size is "" when the decider gave none). Cheapest
 * model first, then the most runs.
 */
export function outcomeStats(runs: Run[]): OutcomeRow[] {
  const escalated = escalatedRuns(runs);
  const groups = new Map<string, { key: string[]; tally: Tally }>();
  for (const run of runs) {
    const key = [modelFamily(run.model), run.job, run.lang, sizeOf(run)];
    const id = JSON.stringify(key);
    const group = groups.get(id) ?? { key, tally: emptyTally() };
    addRun(group.tally, run, escalated.has(run));
    groups.set(id, group);
  }
  const rank = (model: string): number => (rankOf(model) < 0 ? MODEL_ORDER.length : rankOf(model));
  const rows = [...groups.values()].map((g) => rowOf(g.key, g.tally));
  return rows.sort((a, b) => rank(a.model) - rank(b.model) || b.runs - a.runs || text(a.job, b.job) || text(a.lang, b.lang) ||
    text(a.size_level, b.size_level));
}
