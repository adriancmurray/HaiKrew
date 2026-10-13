# Part C: stats

Create `stats.ts`. It exports:
- `createStats(): Stats`. Starts at zero. `hit()` and `miss()` add 1 to their counter. `evict(bytes)` adds 1 to `evictions` and `bytes` to `bytesEvicted`. `snapshot()` returns a new `Snapshot` copy each time.
- `hitRate(s: Snapshot): number`: `ratio(s.hits, s.hits + s.misses)`, with `ratio` from `entry.ts`. Evictions are not lookups.

Shared file `entry.ts`: add `export interface Snapshot { hits: number; misses: number; evictions: number; bytesEvicted: number }` and `export interface Stats { hit(): void; miss(): void; evict(bytes: number): void; snapshot(): Snapshot }`. Do not change the helpers already in the file. Change nothing else.

Rules: `import type` for types, `.ts` in local import paths, no enums or namespaces (Node type stripping). Do not edit other files.
