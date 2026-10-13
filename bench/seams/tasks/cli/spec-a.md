# Part A: argument parser

Create `args.ts`. It exports `parseArgs(argv: string[]): Parsed` (`Parsed` and `isFlag` are in `cli.ts`). It never throws.

- Walk the tokens left to right.
- `--` ends option parsing. Drop it. Every later token is a non-flag, even if it starts with `-`.
- A flag token is one where `isFlag(token)` is true: `--name`, `-name`, `--name=value` or `-name=value`. The name is the text after the leading dashes and before the first `=`. `--name` alone sets `flags[name] = true`. With `=value` it sets `flags[name] = value`, which may be empty. A repeated flag keeps its last value. `flags` is a plain object in which every name, including `__proto__`, `constructor` and `toString`, is an ordinary own key (create it with `Object.create(null)` or set keys with `Object.defineProperty`).
- A non-flag token becomes `command` if no command is set yet. Otherwise it goes into `positional`, in order.
- Flags may come before the command: `--verbose build` gives command `build`.

Shared file `cli.ts`: change nothing.

Rules: `import type` for types, `.ts` in local import paths, no enums or namespaces (Node type stripping). Do not edit other files.
