# Part A: parser

Create `parser.ts`. It exports:

`parseLine(text: string, line: number): Event | Rejected`

- Trim `text` first. Match `^(\d+) (\S+) ([^:\s]+):\s*(.*)$`. No match: return `{ line, reason: "syntax" }`.
- Group 2 is the level. Lowercase it. If it is not `debug`, `info`, `warn` or `error`: return `{ line, reason: "level" }`.
- Group 1 is `ts` (a number). Group 3 is `source`. Group 4, trimmed, is `message`. An empty message is accepted here; the validator rejects it.
- Accepted: return `{ ts, level, source, message }` with exactly these four keys.

Shared file `events.ts`:
- Add `"debug"` as the first member of the `Level` union.
- Add `export function isRejected(x: Event | Rejected): x is Rejected`, which returns true when `x` has a `reason` key. Part C calls it.
- Change nothing else in it.

Rules: `import type` for types, `.ts` in local import paths, no enums or namespaces (Node type stripping). Do not edit other files.
