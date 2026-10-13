/**
 * Checker verdicts that arrive before the run they name is in the ledger. A held verdict sits in the ledger state as
 * `pending`, keyed by its normalized name, and the ledger applies it when a run with that name is added. Entries older
 * than PENDING_MAX_AGE_MS are dropped and the list is capped, so a name that never gets a run cannot pile up.
 */
import { normName } from "./names.ts";

/** A verdict waiting for its run. `name` is normName'd; `ts` is the ISO time it was held; `defects` is the checker's count. */
export type PendingVerdict = { name: string; verdict: "pass" | "fail"; checker: string; ts: string; defects?: number };

/** What a checker's report says about a run it did not yet have a row for. */
export type VerdictHold = { name: string; verdict: "pass" | "fail"; checker: string; defects?: number };

/** Held verdicts older than this are dropped. */
export const PENDING_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** At most this many verdicts are held; the oldest go first. */
export const PENDING_CAP = 50;

/**
 * The held verdicts still within PENDING_MAX_AGE_MS of `now`, the newest PENDING_CAP of them. An entry whose time does
 * not parse is dropped too. The list is in the order the verdicts were held.
 */
export function prunePending(held: PendingVerdict[], now: Date): PendingVerdict[] {
  const fresh = held.filter((h) => now.getTime() - Date.parse(h.ts) <= PENDING_MAX_AGE_MS);
  return fresh.slice(-PENDING_CAP);
}

/**
 * The held verdicts with this one added, replacing any earlier hold for the same name, then pruned as prunePending
 * does. An empty name holds nothing.
 */
export function holdPending(held: PendingVerdict[], hold: VerdictHold, now: Date): PendingVerdict[] {
  const key = normName(hold.name);
  if (!key) return prunePending(held, now);
  const entry: PendingVerdict = { name: key, verdict: hold.verdict, checker: hold.checker, ts: now.toISOString(), ...(hold.defects === undefined ? {} : { defects: hold.defects }) };
  return prunePending([...held.filter((h) => h.name !== key), entry], now);
}
