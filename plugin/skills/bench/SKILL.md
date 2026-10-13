---
name: bench
description: Measure agent setups or models on the HaiKrew bench (terse-spec coding tasks with hidden tests). Use when the user wants to compare setups, models or review settings, or to check whether the checker earns its cost.
---

# Bench: measure a setup before believing it

The bench lives in the `bench/` folder of the HaiKrew repo. Its README holds the tasks, layout and scoring commands. Run it from a clone of that repo; if the current repo has no `bench/`, ask the user where it is.

## Protocol
Launch one Sonnet lab lead (`subagent_type` general-purpose, `model: sonnet`, tag `HAIKREW job=research name=...`) and give it the bench README's protocol:
1. `bench/refcheck.sh` first; every hidden suite must pass on REF.
2. For each task, in two setups:
   - **S**: one `haiku-coder` on the prepared folder (`bench/prep.sh <task> S`). The coder never sees `hidden.test.ts` or `ref/`.
   - **C**: the same, then a `haikrew:haiku-checker` on the folder and spec, then one fix round with the checker's lines. Copy the folder to `C_pre` before the fix round and score both.
3. `bench/score.sh <task> <setup>` for every folder.
4. Record tokens and wall minutes from the agent completion notices.

Setup **B** (two parallel coders, keep the better) is retired: in run 3 it never beat S on hidden passes and cost about double the tokens. Do not rerun it unless the question is specifically about B.

## Report
One table per setup, from the lab lead's own records, with:
- hidden pass (passed/total per task, and the sum);
- checker-found defects: the BROKE entries that show a real defect, per task, including those the hidden suite did not catch;
- tokens (coder, checker, fix round) and wall minutes;
- probes that timed out.

State the number of tasks and attempts, and that one attempt per task is not a rate. End with what was not measured.
