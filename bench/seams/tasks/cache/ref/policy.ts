import type { Entry, Policy } from "./entry.ts";
import { compareEntries } from "./entry.ts";

function cmp(a: number, b: number): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Key of the entry that sorts first under `better`, or undefined for an empty list. */
function pick(entries: Entry[], better: (a: Entry, b: Entry) => number): string | undefined {
  if (entries.length === 0) return undefined;
  return entries.reduce((best, e) => (better(e, best) < 0 ? e : best)).key;
}

/** Least recently used. Ties are broken by compareEntries. */
export function lru(): Policy {
  return { victim: (es) => pick(es, (a, b) => cmp(a.lastUsed, b.lastUsed) || compareEntries(a, b)) };
}

/** Least frequently used, then least recently used. Ties are broken by compareEntries. */
export function lfu(): Policy {
  return {
    victim: (es) => pick(es, (a, b) => cmp(a.hits, b.hits) || cmp(a.lastUsed, b.lastUsed) || compareEntries(a, b)),
  };
}
