# Part B: validator

Create `validator.ts`. It exports:

`validate(ev: Event, line: number): Event | Rejected`

Checks, in this order. The first failure wins and returns `{ line, reason }`:
1. `reason: "ts"`: `ts` is not an integer, or is below 1000000000.
2. `reason: "source"`: `source` does not match `^[a-z][a-z0-9-]*$`.
3. `reason: "empty"`: `message` is empty after trimming.

If all pass: count the message in code points (`[...message]`). When it has more than 200 code points, return `{ ...ev, message: the first 200 code points joined back into a string, truncated: true }`. Never split a code point. Otherwise return `ev` itself, unchanged.

Shared file `events.ts`: add an optional field `truncated?: boolean` to `Event`. Change nothing else in it.

Rules: `import type` for types, `.ts` in local import paths, no enums or namespaces (Node type stripping). Do not edit other files.
