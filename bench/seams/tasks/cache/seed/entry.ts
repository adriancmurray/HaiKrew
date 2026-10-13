/** A cached value and the bookkeeping eviction needs. Times come from the store's clock. */
export interface Entry {
  key: string;
  value: string;
  size: number;
  inserted: number;
  lastUsed: number;
  hits: number;
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
