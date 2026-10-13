import type { Snapshot, Stats } from "./entry.ts";
import { ratio } from "./entry.ts";

/** Counters starting at zero. */
export function createStats(): Stats {
  const s: Snapshot = { hits: 0, misses: 0, evictions: 0, bytesEvicted: 0 };
  return {
    hit: () => {
      s.hits++;
    },
    miss: () => {
      s.misses++;
    },
    evict: (bytes) => {
      s.evictions++;
      s.bytesEvicted += bytes;
    },
    snapshot: () => ({ ...s }),
  };
}

/** Hits over lookups, or 0 when there were no lookups. Evictions do not count. */
export function hitRate(s: Snapshot): number {
  return ratio(s.hits, s.hits + s.misses);
}
