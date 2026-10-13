# Part B: command registry and runner

Create `registry.ts`. It exports:

- `interface Registry { register(cmd: Command): void; get(name: string): Command | undefined; list(): Command[] }`
  - `register` throws `Error("duplicate command: <name>")` if the name is taken.
  - `list()` returns every registered command, hidden ones included, sorted by `name` ascending (plain `<` comparison).
- `createRegistry(): Registry`
- Hidden commands are not special in `runCli`: they run when named.
- `runCli(argv: string[], registry: Registry): RunResult`, which runs these steps in order:
  1. `parseArgs(argv)` from `./args.ts`.
  2. If there is no command, or the key `help` is in `flags`: return `{ code: 0, output: renderHelp(registry.list()) }`. `renderHelp` is from `./help.ts`.
  3. If the command is not registered: return `{ code: 2, output: "unknown command: <name>" }`.
  4. Take the first key of `flags`, in insertion order, that is neither `help` nor in `cmd.flags`. If there is one: return `{ code: 2, output: "unknown flag --<key> for <cmd.name>" }`.
  5. Otherwise return `{ code: 0, output: cmd.run(parsed) }`. If `run` throws, return `{ code: 1, output: <error message> }`.

Shared file `cli.ts`: add `export interface RunResult { code: number; output: string }`. Change nothing else.

Rules: `import type` for types, `.ts` in local import paths, no enums or namespaces (Node type stripping). Do not edit other files.
