# Part C: help renderer

Create `help.ts`. It exports `renderHelp(commands: Command[]): string`.

- Leave out commands with `hidden: true`.
- Sort the rest by `name` ascending (plain `<` comparison).
- Pad every name to the length of the longest visible name.
- Output lines, joined with `\n`, with no trailing newline:
  1. `usage: tool <command> [options]`
  2. an empty line
  3. `commands:`
  4. one line per visible command: two spaces, the padded name, two spaces, then the summary.

For `build` with summary `compile the project` and `test` with summary `run tests`, the last two lines are `  build  compile the project` and `  test   run tests`.

Shared file `cli.ts`: add an optional field `hidden?: boolean` to `Command`. Change nothing else.

Rules: `import type` for types, `.ts` in local import paths, no enums or namespaces (Node type stripping). Do not edit other files.
