---
name: crew-overseer
description: Overseer workflow for getting code written by cheap haiku-coder subagents while the main model only specs, dispatches and verifies. Use at the start of any task that means writing or changing more than a few lines of code (a feature, a module, a refactor, tests, a script, an asset pipeline), whether or not the repo has a verify command, and whenever launching agents, instead of doing it all inline or launching default (Opus) agents.
---

# Haiku crew: Opus plans, Haiku writes, tools verify

**Why:** a subagent with no `model` inherits the main model. Default agents therefore run on Opus and burn the usage limit faster. Code-writing goes to `haiku-coder` (model: haiku). The main model's output stays thin: specs in, verdicts out.

## Model tiers
| Work | Who |
|---|---|
| Design, decisions, contracts, reviewing diffs that touch security, protocol or concurrency | Main model (Opus), inline, no subagent |
| Writing code to a spec, mechanical refactors, renames, tests from a list of cases, codegen adoption | `haiku-coder` |
| A task Haiku blocked on twice, or one needing judgment across many files | `Agent` with `model: "sonnet"`, same spec |
| Broad read-only search | `Explore` with `model: "haiku"` |

Never launch an agent without `subagent_type: "haiku-coder"` or an explicit `model`.

## Writing the spec (the overseer's real job)
A good spec makes Haiku's job mechanical. Each one fits on one screen and contains:
1. **Where:** the worktree path (a `git worktree add` for the branch, so the agent never touches the main checkout).
2. **What:** files to create or edit; the exact public signatures, types and Operation names; the behaviour in numbered rules.
3. **Done when:** the named tests pass under `haikrew verify` (with no verify command: one runnable check you name, such as `node --check` plus a small assert script). Prefer writing the tests (or the list of test cases with expected results) yourself, then letting Haiku implement against them.
4. **Out of scope:** what not to touch.
5. **Commit:** whether to commit on the branch.

Split work so each spec is one crate or module and about 300 lines of output or less. Several small Haiku agents beat one big one. Run them in parallel only when they touch different repos, because builds queue on the heavy lock anyway.

## Review tiers (keep it cheap)
When a subagent finishes, HaiKrew writes a review packet (spec, report, files changed, test claim) and posts a review note naming a tier. Don't open the agent's transcript; the packet and the report (120 words at most) are enough.
- **Light** (only docs or tests, a small diff, tests not failing): glance at the diff, then call `record_verdict` with pass or fail.
- **Standard** (everything else): launch the reviewer the note names with `HAIKREW job=review name=<Name>`. Tell it to call `review_packet` first and to end with `VERDICT: PASS|FAIL for <Name>`.
- **Deep** (a sensitive path, a large diff, a security, migration, concurrency or protocol job, failing tests, or a model with a weak record on this job): the same, with the deep reviewer.

The checker's verdict replaces the run's own in the ledger, marked with the checker's name. Then:
1. Run `haikrew verify` yourself in the worktree. Trust the verdict, not the report, and read only the diff hunks that carry risk: public API, unsafe code, concurrency, permissions.
2. If a review or verify fails, send a short correction with SendMessage to the same agent (its context is intact), or re-run the work. Fix failed work before building on it. After two failed corrections, escalate to Sonnet or do it inline.

## Budget discipline
- One round of agents per user message. Say up front how many agents and what each does.
- Ask for reports at most 120 words long. Never ask an agent to paste test output.
- Don't re-read files the spec already summarised. Don't re-derive what the decision docs already say.
