---
name: crew-overseer
description: Overseer workflow for getting code written by cheap haiku-coder subagents while the main model only specs, dispatches and verifies. Use at the start of any task that means writing or changing more than a few lines of code (a feature, a module, a refactor, tests, a script, an asset pipeline), whether or not the repo has a verify command, and whenever launching agents, instead of doing it all inline or launching default (Opus) agents.
---

# Haiku crew: Opus plans, Haiku writes, tools verify

**Why:** a subagent with no `model` inherits the main model. Default agents therefore run on Opus and burn the usage limit faster. Code-writing goes to `haiku-coder` (model: haiku). The main model's output stays thin: specs in, verdicts out.

## Model tiers
| Work | Who |
|---|---|
| Design, decisions, contracts | Main model (Opus), inline, no subagent |
| Reviewing diffs that touch security, protocol or concurrency | `haikrew:sonnet-reviewer` at the deep model the note names (see Review tiers) |
| Writing code to a spec, mechanical refactors, renames, tests from a list of cases, codegen adoption | `haiku-coder` |
| A task Haiku blocked on twice, or one needing judgment across many files | `Agent` with `model: "sonnet"`, same spec |
| Broad read-only search | `Explore` with `model: "haiku"` |

Never launch an agent without `subagent_type: "haiku-coder"` or an explicit `model`. Sonnet and Opus subagents receive a lead note and run their own Haiku crew.

## Writing the spec (the overseer's real job)
A good spec makes Haiku's job mechanical. Each one fits on one screen and contains:
1. **Where:** the worktree path (a `git worktree add` for the branch, so the agent never touches the main checkout).
2. **What:** for a fix, the root cause with file:line (find it first with a read-only `Explore`, not by the coder); files to create or edit; the exact public signatures, types and Operation names; the behaviour in numbered rules.
3. **Done when:** the named tests pass under `haikrew verify`, the same checks the release runs; don't name a narrower test command (with no verify command: one runnable check you name, such as `node --check` plus a small assert script). Prefer writing the tests (or the list of test cases with expected results) yourself, then letting Haiku implement against them.
4. **Out of scope:** what not to touch.
5. **Commit:** whether to commit on the branch.

Split work so each spec is one crate or module and about 300 lines of output or less. Several small Haiku agents beat one big one. Run them in parallel only when they touch different repos, because builds queue on the heavy lock anyway.

## Review tiers (keep it cheap)
When a subagent finishes, HaiKrew writes a review packet (spec, report, files changed, test claim) and posts a review note naming a tier. Don't open the agent's transcript; the packet and the report (120 words at most) are enough. The note says what to do. If HaiKrew's review tools are on (Settings › General › Agent control set to read or change), it names them; if they are off, the note carries the packet text and names no tool.
- **Light** (only docs or tests, a small diff, tests not failing): launch the checker the note names, `haikrew:haiku-checker`, with `HAIKREW job=check name=<Name>`. It is an adversarial Haiku checker: it checks each spec item, runs verify and tries to break the change, and ends with `VERDICT: PASS|FAIL for <Name>`, which sets the run's verdict. Its `job=check` tag keeps it off the `job:review` routing rule. With `review.light_reviewer` set to inline, glance at the diff and call `record_verdict` with pass or fail instead (with the tools off, say pass or fail in your reply).
- **Standard** (everything else): launch `haikrew:sonnet-reviewer` (read-only; it reviews the risky hunks, runs the tests and reports in 120 words) with the model and effort the note names and `HAIKREW job=review name=<Name>`. With the tools on, tell it to call `review_packet` first; with them off, paste the packet from the note into its prompt. Either way it ends with `VERDICT: PASS|FAIL for <Name>`.
- **Deep** (a sensitive path, a large diff, a job such as security, migration, concurrency or protocol (`security-review` counts too), failing tests, or a model with a weak record on this job): the same as standard, with the deep reviewer the note names. Only when `review.deep_inline` is on and the main model is at least as strong as that reviewer (haiku < sonnet < opus) does the note say the review is inline. Then review the risky hunks yourself (public API, security, concurrency, permissions, data loss), record the result, and launch no reviewer.

The checker's verdict replaces the run's own in the ledger, marked with the checker's name. Then:
1. Launch `haikrew:haiku-checker` with the spec and the agent's name, and read only its five-line report. Do not run `haikrew verify` or read diff hunks yourself.
2. On FAIL, SendMessage the worker the failing lines. After two failed corrections, re-run the work on the next model up.
3. When fixes keep landing in the same area (a third fix/review round on the same module), stop the loop: that is a design problem, not a run of bugs. Read that area yourself once, then fix it inline or write one spec that redesigns it, and review that once.

## Thin main thread
Every tool call re-reads the whole conversation, so the main thread must not explore, read diffs or logs, or run tests. Send exploration to `Explore` (model haiku) and verification to `haikrew:haiku-checker`, act on their short reports, put the steps of any direct action in one tool call, and keep inline only decisions, specs and edits of a few lines.

## Budget discipline
- One round of agents per user message. Say up front how many agents and what each does.
- Ask for reports at most 120 words long. Never ask an agent to paste test output.
- Don't re-read files the spec already summarised. Don't re-derive what the decision docs already say.
