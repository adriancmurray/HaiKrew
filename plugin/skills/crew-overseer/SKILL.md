---
name: crew-overseer
description: Overseer workflow for getting code written by cheap haiku-coder subagents while the main model only specs, dispatches and verifies. Use whenever delegating implementation work to a repo with a verify command, instead of launching default (Opus) agents.
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
3. **Done when:** the named tests pass under `haikrew verify`. Prefer writing the tests (or the list of test cases with expected results) yourself, then letting Haiku implement against them.
4. **Out of scope:** what not to touch.
5. **Commit:** whether to commit on the branch.

Split work so each spec is one crate or module and about 300 lines of output or less. Several small Haiku agents beat one big one. Run them in parallel only when they touch different repos, because builds queue on the heavy lock anyway.

## Verifying (keep it cheap)
1. Read the agent's report (120 words at most). Don't open its transcript.
2. Run `haikrew verify` yourself in the worktree. Trust the verdict, not the report.
3. Review with `git diff --stat main` and then read only the diff hunks that carry risk: public API, unsafe code, concurrency, permissions, anything security-related. Skip generated files and tests unless something looks wrong.
4. If it fails: send a short correction with SendMessage to the same agent (its context is intact) rather than starting a new one. After two failed corrections, escalate to Sonnet or do it inline.

## Budget discipline
- One round of agents per user message. Say up front how many agents and what each does.
- Ask for reports at most 120 words long. Never ask an agent to paste test output.
- Don't re-read files the spec already summarised. Don't re-derive what the decision docs already say.
