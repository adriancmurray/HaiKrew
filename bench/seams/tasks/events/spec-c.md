# Part C: aggregator

Create `aggregator.ts`. It exports:

- `summarize(events: Event[]): Summary`
  - `total`: number of events. `byLevel`: all four keys `debug`, `info`, `warn`, `error`, with counts, zero when none. `bySource`: an ordinary object with a count per source, only sources seen. A source named `constructor` (or any other Object.prototype name) counts like any other source. `truncated`: number of events with `truncated === true`.
- `interface Report { summary: Summary; rejected: Rejected[] }` (export it)
- `runPipeline(lines: string[]): Report`
  - Line numbers are 1-based positions in `lines`.
  - A line that is empty after trimming is skipped silently. It still takes a line number.
  - Otherwise call `parseLine(text, n)` from `./parser.ts`. If the result is rejected, record it. Otherwise call `validate(ev, n)` from `./validator.ts`: record a rejection, or collect the accepted event.
  - `summary = summarize(accepted)`. `rejected` is in input order.

To tell parse and validate results apart, use `isRejected(x: Event | Rejected): x is Rejected` from `events.ts`. Part A adds it to that file.

Shared file `events.ts`: add exported interface `Summary { total: number; byLevel: Record<Level, number>; bySource: Record<string, number>; truncated: number }`. Change nothing else in it.

Rules: `import type` for types, `.ts` in local import paths, no enums or namespaces (Node type stripping). Do not edit other files.
