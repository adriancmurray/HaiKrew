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
