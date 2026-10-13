# cli: arg parser, command registry, help

Goal: a small command runner. The `Command` and `Parsed` types and the `isFlag` helper live in
`cli.ts`. The parser splits argv, the registry looks commands up and runs them, and the help
renderer lists them. The registry adds `RunResult` and the help renderer adds `hidden`.
