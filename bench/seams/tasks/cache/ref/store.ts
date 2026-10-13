import type { Entry, StoreOptions } from "./entry.ts";
import { sizeOf } from "./entry.ts";

/** A byte-budgeted key/value store. */
export interface Store {
  set(key: string, value: string): void;
  get(key: string): string | undefined;
  has(key: string): boolean;
  delete(key: string): boolean;
  keys(): string[];
  bytes(): number;
}

/** A store that evicts through `opts.policy` whenever it goes over `opts.maxBytes`. */
export function createStore(opts: StoreOptions): Store {
  const entries = new Map<string, Entry>();
  const now = opts.now ?? (() => Date.now());
  const bytes = () => {
    let n = 0;
    for (const e of entries.values()) n += e.size;
    return n;
  };
  return {
    set(key, value) {
      const size = sizeOf(value);
      if (size > opts.maxBytes) throw new RangeError("value too large");
      entries.delete(key);
      const t = now();
      entries.set(key, { key, value, size, inserted: t, lastUsed: t, hits: 0 });
      while (bytes() > opts.maxBytes) {
        const others = [...entries.values()].filter((e) => e.key !== key);
        const victim = opts.policy.victim(others);
        const evicted = victim === undefined ? undefined : entries.get(victim);
        if (!evicted) break;
        entries.delete(evicted.key);
        opts.stats.evict(evicted.size);
      }
    },
    get(key) {
      const e = entries.get(key);
      if (!e) {
        opts.stats.miss();
        return undefined;
      }
      e.lastUsed = now();
      e.hits++;
      opts.stats.hit();
      return e.value;
    },
    has: (key) => entries.has(key),
    delete: (key) => entries.delete(key),
    keys: () => [...entries.keys()].sort(),
    bytes,
  };
}
