---
name: haikrew
description: Coordinate bounded Codex helper tasks with model routing, independent verification, and optional MacBook Minion tool placement. Use when asked for HaiKrew or a Codex crew; simple work can stay inline.
---

# HaiKrew for Codex

Keep task ownership, design and integration in the current main conversation.
This standalone adaptation does not load the Claude Code plugin or change the
main model. Follow the repository's instructions and the user's authorization.

## Check the receiving runtime

Before dispatch, inspect the live collaboration tools for model names, reasoning
efforts, fork semantics and concurrency. The supplied policy and router model
allowlist reflect the originating runtime; their presence is not proof that a
model is available in yours. Adapt both before use if the supported names differ.
Do not install tools or make hidden API calls to substitute unavailable models.

The example [routing policy](config/routing.json) uses these originating aliases:

| Task | Model alias | Effort |
| --- | --- | --- |
| Bounded research, scouting, documentation | `gpt-6-luna` | `medium` |
| Routine implementation, tests, standard review | `gpt-6.1-sol` | `medium` |
| Security, authentication, migrations, concurrency, deployment | `gpt-6-astra` | `high` |

Sensitive words override cheaper job tags. Routing is a deterministic lexical
heuristic, so inspect the result when wording crosses categories.

## Portable dispatch

Use this path until native hook interception is proven in the receiving runtime.
Prepare the complete proposed `spawn_agent` arguments, then pass this envelope
on stdin to [scripts/router.py](scripts/router.py):

```json
{
  "hook_event_name": "PreToolUse",
  "tool_name": "spawn_agent",
  "tool_input": {
    "task_name": "parser_fix",
    "fork_turns": "none",
    "message": "HAIKREW job=implement\nWorkspace: /absolute/isolated/worktree. Task: ... Owned files: ... Constraints: ... Done when: ... Required checks: ... Do not commit or spawn agents. Return at most 120 words with changes, checks, and concerns."
  }
}
```

On `allow`, pass the complete `hookSpecificOutput.updatedInput` to the advertised
collaboration spawn tool. On `deny`, resolve the input/policy issue first. An empty
response preserves the original inheritance request. Do not use `--log` for
portable dispatch: that could be mistaken for evidence of native interception.
The decision here is routing data and grants no tool approval.

Explicit supported model/effort choices are preserved. An explicit model without
an effort retains the runtime's default effort. Specify both when a deliberate
review tier matters. `fork_turns: "all"` preserves inheritance; this adapter rejects
model/effort overrides with that fork mode. Missing `fork_turns` becomes `none`,
so always include the worker's necessary context in the brief.

## Scope and coordinate workers

Inspect the relevant repository instructions and source contracts. Each bounded
brief names the workspace and baseline, owned files, required behavior and cases,
acceptance checks, exclusions, concurrent owners and commit policy. Default to
no commit unless authorized. Preserve unrelated dirty work.

Use only the live available agent slots. Assign one build/test owner per shared
checkout or build directory. Workers should not spawn further agents unless the
overseer has explicitly assigned a bounded delegation budget. Retain the returned
agent identifier and inspect completion; dispatch acceptance is not completion.
Use the available message/follow-up tools to correct or resume an existing worker.

## Place portable tools on MacBook Minion

When the separate `macbook-minion` skill is installed, use it for suitable tests,
builds, conversion or public research. Its `pressure`, `route` and `offload`
commands observe capacity and submit through the existing canonical config and
shared queue. Preserve worker/job IDs, check exit status and checksum-verified
artifacts, then review and integrate the result. Missing quota readings remain
unknown. Model reasoning stays with the subscription agent; moving tools does
not add subscription capacity. See the integration notes in `codex/README.md`
in the source repository for the optional dependency and command sequence.

## Review and verify

Review the actual diff/source and verification evidence, not just the worker's
summary. Small low-risk changes can be reviewed directly. Normal implementation
benefits from an independent reviewer; security, permissions, data-loss,
migrations and concurrency need the strongest available appropriate review tier.
Honor a user's explicit review hold or delegation constraint.

Run the repository's required checks plus focused checks for changed behavior.
Use `.haikrew/verify` only after inspecting it and confirming that it covers the
required checks and its prerequisites exist. This adaptation supplies no Codex
verdict ledger, crew pane or separate `haikrew verify` tool.

Keep worker/reviewer replies compact: files/scope, commands and results, concrete
concerns, and `VERDICT: PASS|FAIL for <task_name>` for a review. Preserve detailed
failures in artifacts. After repeated correction failures, reconsider the spec
or escalate to an available stronger model instead of looping on patches.

Report changed behavior, verification and remaining limits. Distinguish local
tests, a requested model, actual worker completion, native hook interception,
merge, deployment and observed runtime behavior.

## Optional native interception

Read the native-hook section of `codex/README.md` in the source repository before
configuring anything. Non-managed hooks need user review/trust in `/hooks`.
Never manufacture trust hashes. Local command hooks do not run under cloud
orchestration merely because tool execution happens on a local computer.
Prove interception with a real no-model spawn, its hook receipt and the launched
worker's actual model. Fixture tests prove routing decisions only.

## Provenance

Adapted from HaiKrew's `plugin/skills/crew-overseer/SKILL.md`, originally based on
commit `3601de247dbc6b94d04da89ef7e21c83ddcbe0b5`. The Python router and policy are
the existing Codex setup contributed with this WIP; they do not modify the
Claude plugin or provide a security boundary.
