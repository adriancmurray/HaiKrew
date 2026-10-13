# Part A: store

Create `store.ts`. It exports `createStore(opts: StoreOptions): Store` and `interface Store`:
- `set(key: string, value: string): void`
- `get(key: string): string | undefined`
- `has(key: string): boolean`
- `delete(key: string): boolean`
- `keys(): string[]`, sorted with the default `Array.prototype.sort`
- `bytes(): number`, the total `size` of all entries

Rules:
- `now` defaults to `() => Date.now()`.
- `set`: `size = sizeOf(value)` (from `entry.ts`). If `size > opts.maxBytes`, throw `RangeError("value too large")` and change nothing. Otherwise replace any entry for the key with `{ key, value, size, inserted: t, lastUsed: t, hits: 0 }`, where `t = now()`. Then, while `bytes() > opts.maxBytes`: call `opts.policy.victim(...)` with the entries except the key just set. If it returns undefined, stop. Otherwise delete that entry and call `opts.stats.evict(victim.size)` with the evicted entry's `size`.
- `get`: if the key is present, set `lastUsed = now()`, add 1 to `hits`, call `opts.stats.hit()`, and return the value. If missing, call `opts.stats.miss()` and return undefined.
- `has` and `delete` do not touch stats or `lastUsed`.

Shared file `entry.ts`: add `export interface StoreOptions { maxBytes: number; policy: Policy; stats: Stats; now?: () => number }`. Do not change the helpers already in the file. Change nothing else.

Rules: `import type` for types, `.ts` in local import paths, no enums or namespaces (Node type stripping). Do not edit other files.
