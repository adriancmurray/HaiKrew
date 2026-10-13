/** A cached value and the bookkeeping eviction needs. Times come from the store's clock. */
export interface Entry {
  key: string;
  value: string;
  size: number;
  inserted: number;
  lastUsed: number;
  hits: number;
}

/** Chooses which entry to evict. Returns undefined when there is nothing to choose from. */
export interface Policy {
  victim(entries: Entry[]): string | undefined;
}

/** Counters a store reports into. `evict` takes the evicted entry's size in bytes. */
export interface Stats {
  hit(): void;
  miss(): void;
  evict(bytes: number): void;
  snapshot(): Snapshot;
}

/** A copy of the counters at one moment. */
export interface Snapshot {
  hits: number;
  misses: number;
  evictions: number;
  bytesEvicted: number;
}

/** Configuration for createStore. `now` defaults to Date.now. */
export interface StoreOptions {
  maxBytes: number;
  policy: Policy;
  stats: Stats;
  now?: () => number;
}

/** UTF-8 byte length of a value. The store's budget counts these bytes. */
export function sizeOf(value: string): number {
  return new TextEncoder().encode(value).length;
}

/** Orders two entries by insertion time, then by key. Policies use it to break ties. */
export function compareEntries(a: Entry, b: Entry): number {
  if (a.inserted !== b.inserted) return a.inserted - b.inserted;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/** `part / whole`, or 0 when `whole` is 0. */
export function ratio(part: number, whole: number): number {
  return whole === 0 ? 0 : part / whole;
}
