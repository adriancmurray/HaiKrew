# swarm bench: terse-spec Haiku coding tasks

Measures how often a cheap coder agent passes hidden, convention-level tests when the spec is a
short issue-style request (about 5 lines, no edge cases named), and whether parallel coders (B) or a
checker plus fix round (C) help.

Needs Node 22.6+ (type stripping; developed on Node 25), and `timeout` on the PATH (GNU coreutils on macOS). No dependencies.

## Layout
- `tasks/<task>/spec.md`      the terse spec given to the coder
- `tasks/<task>/starter/`     the existing module, its caller(s), and `visible.test.ts` (existing tests plus 2-4 smoke tests of the new feature)
- `tasks/<task>/hidden.test.ts`  15-20 hidden cases (empty/unicode/large input, aliasing, error types, existing callers)
- `tasks/<task>/ref/`         reference solution files (overwrite the starter's files)
- `prep.sh <task> <setup>`    creates `runs/<task>/<setup>/` from the starter plus spec.md
- `score.sh <task> <setup>`   prints `task setup vis=P/T hidden=P/T` (hidden suite is copied in, run, and removed)
- `refcheck.sh [task...]`     sanity check: hidden suite must pass 100% on `ref/` and fail partly on the bare starter

Tasks: pager, retry, debounce, sort, paths, tpl.

## Rerun
1. `./refcheck.sh` (suites must be green on REF).
2. For each task and setup, `./prep.sh <task> <S|B1|B2|C>`, then point a coder agent at the run folder
   (prompt: tag line, "work only in this folder", the contents of spec.md, `node --test visible.test.ts`).
   Do not show the coder `tasks/*/hidden.test.ts` or `ref/`.
3. `./score.sh <task> <setup>` for each folder.
   - S: one coder. B: two coders, keep the one with more visible passes (ties: your own extra edge cases).
   - C: coder, then a checker agent reading the folder and spec, then one fix round with the checker's lines; score before and after the fix (copy the folder to `C_pre` before the fix round, or score first).
4. Record tokens and wall minutes from the agent completion notices in a ledger of your own.

`runs/` is generated and can be deleted.

## Setups
- S: one coder. The baseline.
- C: coder, then a checker, then one fix round with the checker's lines.
- B (two parallel coders, keep the better): retired. It never beat S on hidden passes and costs about double the tokens.

## Results (run 3, 6 tasks, one attempt each)
Hidden-suite passes, first attempt:

| task | S | B1 / B2 | C before -> after fix |
|---|---|---|---|
| pager | 19/19 | 19/19, 15/19 | 19/19 -> 19/19 |
| retry | 17/17 | 17/17, 17/17 | 17/17 -> 17/17 |
| debounce | 17/20 | 17/20, 17/20 | 17/20 -> 17/20 |
| sort | 18/18 | 18/18, 18/18 | 18/18 -> 18/18 |
| paths | 21/21 | 21/21, 21/21 | 21/21 -> 21/21 |
| tpl | 18/19 | 16/19, 16/19 | 16/19 -> 18/19 |

- Tokens: S coders used 16.5k to 18.1k each; the checker added 17.4k to 22.9k; the C coder's total after the fix round was 20.1k to 23.9k.
- Wall time: coders 15 to 33 s, checkers 26 to 150 s, fix rounds 2 to 5 min including waiting.
- The retry checker hung twice on its own infinite-loop probe and was killed by hand. The checker agent now wraps every probe in a timeout.
- Pager and retry used 5-line specs; debounce, sort, paths and tpl used 2-3 line specs (shortened after S passed everything on the first two).
- Hidden tests alone do not show the checker's value: only tpl moved on them. Defects the checker found by hand-written probes are not scored here; count them from the checker's BROKE lines.

## Seams bench (bench/seams)

Measures whether three coders building in parallel can agree on a shared interface. Each task has
a shared file (`seed/`), three part specs (`spec-a.md`, `spec-b.md`, `spec-c.md`), a hidden suite
(`hidden/`: `unit-*.test.ts` per part plus `integration.test.ts`) and a reference solution (`ref/`).
Tasks: events, cart, cli, cache. Node 22.6+ (type stripping) and `timeout` on the PATH; no dependencies.

Scripts (run from `bench/seams/`):
- `./prep.sh <task> <dir>`: copies `seed/` and the three specs into an empty or new `<dir>`. Never copies `hidden/` or `ref/`.
- `./score.sh <dir>`: copies each hidden suite in, runs it, removes it, and prints `SCORE task=<t> unit=<p>/<n> integration=<p>/<n>`.
- `./refcheck.sh`: builds each `ref/` in a temp dir and scores it. Exits 1 unless every task has full marks.

How a run works:
1. Director (Sonnet by default, to keep Opus use down) reads the task's spec files and runs `prep.sh` to make a fresh `<dir>`.
2. Director launches three Haiku coders in parallel on `<dir>`, one each with spec-a, spec-b or spec-c, plus the tag line and "work only in this folder". The director does not show coders `hidden/` or `ref/`.
3. Arm A gives the specs as written, with today's spec discipline. Arm B adds the board (claims, contracts, decisions) once it is built.
4. When all three return, run `score.sh <dir>`. A fix round sends the failing integration lines to the coder whose part is responsible. Re-score after each round.
5. Runs: 4 tasks x 3 runs per arm, so 12 runs per arm.

Metrics to record per run:
- integration first try: the integration count on the first score, out of its total.
- overlapping writes: shared-file writes by more than one coder, and additions lost by a later write.
- fix rounds to green.
- director input tokens spent on orchestration.
- wall time, from launch to the last coder's return.

Known limits: the specs and hidden suites were written by the same author, and refcheck shows only that the reference satisfies them, not that the specs are sufficient. Expect the first real runs to show spec gaps.
