# Part B: eviction policies

Create `policy.ts`. It exports `lru(): Policy` and `lfu(): Policy`, where `Policy` is in `entry.ts`. Each returns an object whose `victim(entries)` returns the key to evict, or `undefined` for an empty list. Do not modify the entries.
- `lru`: the entry with the smallest `lastUsed`.
- `lfu`: the entry with the smallest `hits`, then the smallest `lastUsed`.
- Any remaining tie is broken by `compareEntries(a, b)` from `entry.ts` (smaller `inserted`, then smaller `key`). Call it; do not re-implement it.

Shared file `entry.ts`: add `export interface Policy { victim(entries: Entry[]): string | undefined }`. Do not change the helpers already in the file. Change nothing else.

Rules: `import type` for types, `.ts` in local import paths, no enums or namespaces (Node type stripping). Do not edit other files.
