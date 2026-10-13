HaiKrew is a Claude Code mod. It sets the model used for agent launches (the gate), adds squeeze and read guards on tool calls, keeps a ledger of agent runs, and shows the crew in a `/haikrew` pane. Release 0.1.0 introduced the gate, guards, ledger, pane, the haiku-coder and haiku-scout agents and the crew-overseer skill. Releases 0.4.0 to 0.5.5 added per-task model rules, rule effort and selectors, checks, ledger suggestions and a packaging change. Releases 0.6.0 to 0.6.5 redesigned the `/haikrew` pane and the band above the prompt, made the crew the default route for spec-able work, gave subagents names, set token warnings per model and added review tiers. The newest release covered here is 0.6.5, dated 2026-10-12.

## Unreleased

- Decider slot: a `decider` settings section (`mode` off, shadow or decide; `url`, `timeout_ms`, `min_confidence`, `explore_rate`) asks a SystemOne-compatible endpoint (the local Clefkit server at http://127.0.0.1:8790, Jev or a proxy) for a model, effort and review need for launches that name no model and match no rule. Shadow only records the answer; decide applies a confident model and effort (Opus still needs Allow Opus). Errors and timeouts leave the launch as it was. The task text (first 4000 characters), the tag, the session folder's name and a table of past results are sent to the endpoint.
- Exploration: with probability `explore_rate`, a pick above Haiku runs on the next cheaper model when the endpoint gives it at least 0.25. Such runs are marked and get at least a standard review. Shadow mode records "would explore" only.
- Each ledger run keeps a `decision` (mode, model, effort, review, confidence, explored, latency, model probabilities) until the run is folded into a monthly bucket. History sent to the endpoint uses mean tokens in the `median_tokens` field.

## 0.6.5 — 2026-10-12

- Review tiers: when a subagent finishes, HaiKrew picks how its work gets checked from the files it changed, the size of the change, its test claim, its job and the model's checked record: light (the main agent glances), standard (a Sonnet reviewer) or deep (an Opus reviewer, or Sonnet when Opus is not allowed). Thresholds and reviewer models are `review.*` settings.
- Reviewers start from a context packet (the original spec, the agent's report, the files it changed, its test claim) through the new `review_packet` tool, and the main conversation gets a one-line note with the tier.
- The checker's verdict replaces the worker's: a reviewer ends with `VERDICT: PASS|FAIL for <name>`, or the main agent calls `record_verdict`; pass rates count checked work.
- Fixes from a review: the one-time ledger repair skips unreadable transcripts and keeps runs added meanwhile; a resumed agent shows as working and keeps its earlier tokens.
- The band re-anchors its animation timing on every redraw, stays under the 131k limit at any width, and re-reads agents' latest lines at most every 10 seconds; a larger magnifier and a swaying thinking pose.
- Pane rows keep their buttons inside the card when text is long; the band's hover card leads with a small transcript icon.
- `patterns check` reads `--dir` (default `./patterns`) and fails when the folder is missing; the unread `patterns.*` settings are gone.

## 0.6.4 — 2026-10-12

- The band above the prompt draws Claude bots in vector art. Their faces change with mood, and their poses show desk or terminal work, a magnifier, a book, a thought bubble, coffee while waiting, and a gauge when an agent passes its token limit.
- The crowned main agent mirrors the live turn: thinking, writing, reading, editing, running a command, searching or directing.
- The scenery behind the bots is mountains, a city, a forest or hills, with a sky that follows the clock and shows the real moon phase. Extras include shooting stars, aurora, lit windows, fireflies, birds, snow in winter and leaves in autumn.
- Subagents get names. The main agent picks one per tag line, and HaiKrew falls back to a list of 46. A spec's tag line may set the name. Names appear in hover cards (with activity, elapsed time and tokens), the crew card and the transcript pane, with the agent type shown beside them. The delegation note asks the main agent to name its agents.
- Token warnings are per model: Haiku 800k, Sonnet 400k, Opus 200k. They scale with effort (low 0.5x, medium 1x, high 1.5x, xhigh 2x, max 3x). `checks.token_warning` is replaced by `checks.token_limits` and `checks.token_effort_scale`. An unknown model takes the smallest limit.
- The band redraws only when its state changes, with a 15-minute tick so an idle sky keeps moving. Animations continue rather than restarting on redraw.
- The band is an exact 3-row height, with smaller pixels and stars across the whole sky.

## 0.6.3 — 2026-10-12

- The ledger judges a run by its last `VERDICT: PASS|FAIL` or `STATUS: done|blocked` line. Runs with neither line are unjudged and left out of pass rates. Before this change they counted as failures (165 of 167 runs in the author's ledger).
- Token counts are new work (input, cache writes and output), counted live per step. Cache reads are shown separately as "cached".
- On first start, kept runs are re-read once from their transcripts (ledger_v2). Suggestions use judged runs only.
- The main agent leads the band above the prompt. It stands larger than the subagents in its model's colour, wears a crown, wizard hat or cap, and shows whether it is working, directing, waiting or asleep.
- Subagents in the band have two legs and arms and act out their work. A pixel sky follows the clock, with stars, the real moon phase and optional clouds. The sun or moon opens the pane. Model colours are settings (Haiku purple, Sonnet teal, Opus orange).
- Hover cards no longer overlap, and each subagent's card opens its transcript in a HaiKrew pane.
- A pinned agent type matches with or without its plugin prefix, so `haikrew:haiku-coder` keeps its own model.

## 0.6.2 — 2026-10-12

- Fixed: the agent tools `status`, `set_setting`, `add_rule` and `remove_rule` showed an error on every call, even when the change had been saved. Claude Code rejects a plain object as a tool result.
- `status` now answers with its report as JSON text. The change tools answer with a one-line confirmation.
- A wiring test calls each tool and checks that the answer is text and that the change landed.

## 0.6.1 — 2026-10-12

- The gate asks the main model to hand work to the crew. A new setting, `gate.delegate`, is on by default and is only active while the gate is on. It adds a short note to the main conversation's CLAUDE.md text, a standing request to hand spec-able work to haiku-coder and haiku-scout. Subagents never receive the note.
- The note states the current default model, the Opus setting, the routing rules and nesting.
- The crew-overseer skill triggers on any task that writes more than a few lines of code, with or without a verify command.
- The pane's Routing summary shows "crew preferred".

## 0.6.0 — 2026-10-12

- The `/haikrew` pane is redesigned as one page in the desktop app. It opens with a pixel-art banner, then Controls, Your crew (each working agent's latest message), Token use, Track record and Settings. Each card folds to one line.
- The animated crew walks in a band above the prompt and opens the pane from a hover button.
- Rules, instructions, default effort and squeeze patterns are chosen from dropdowns and buttons, and read as sentences. Stored formats are unchanged. On/off settings are shown as Off | On. The terminal keeps a plain three-tab version.
- New settings: `pane.open_on_start`, `pane.time_style`, `pane.crew_band` and `agents.control` (off by default).
- New agent tools: `status`, `set_setting`, `add_rule` and `remove_rule`. They cannot change agent control or allow Opus.
- Suggestions go both ways. A job that a stronger model nearly always passes is offered one model down, replacing its rule. Untagged runs get an inferred job, shown as inferred and never turned into rules.
- A failed agent offers "Retry on Sonnet", which asks the main conversation to rerun it.
- `checks.token_warning` (200k by default) warns when one subagent passes that many tokens, with a toast, a mark in the crew and a "!" in the band.

## 0.5.5 — 2026-10-08

- The ledger no longer builds its strings from templates.
- Guard wording no longer uses the word "pass", which a directory scan had flagged as a false trigger.
- No behaviour change is described in the commit.

## 0.5.4 — 2026-10-08

- Comments and literals that a directory scan read as environment reads or built commands are reworded.
- No behaviour change is described in the commit.
- Part of a run of releases (0.5.3 to 0.5.5) that reword code to stop directory scan false triggers.

## 0.5.3 — 2026-10-08

- The settings rename is finished.
- A settings loop variable and a heading regex are renamed or reworded, because a directory scan flagged them.
- No behaviour change is described in the commit.

## 0.5.2 — 2026-10-08

- Squeeze logs are written to the temp folder.
- The exact seam prompt is now disclosed.
- Test examples use neutral paths.

## 0.5.0 — 2026-10-08

- Rules can set an effort level, and there is a default effort.
- Rules can match on language (`lang`) and working directory (`cwd`) selectors, and on combined terms.
- Gate settings can carry agent instructions.
- A checks section adds a hook-bypass guard and a parallel-batch seam check.
- The ledger offers rule suggestions. Adding a suggested rule takes two presses.

## 0.4.0 — 2026-10-08

- The gate is off by default. A fresh install passes agent launches through unchanged.
- Per-task model rules: ordered rules on `job:`, `type:` or `desc:` map a task to a model. `gate.rules_override` lets a matching rule replace a model that the launch names.
- The Opus check applies to the model a rule resolves to, and names the rule that chose it.
- Removed: the stats CLI (which read `~/.claude/projects`) and the `HAIKREW_DATA` environment override.
- The README discloses every hook, the session usage shown in the Tokens tab, and what is not read.
- The plugin is packaged in `plugin/`, settings are kept in the mod store, and process use is dropped.
- A pixel icon: a crew lead with three outlined crew members.

## 0.1.0 — 2026-10-08

- First release of HaiKrew, a Claude Code mod for token-efficient agent crews.
- A model gate on agent launches, with squeeze and read guards on tool calls.
- A condensing ledger of agent runs, and a `/haikrew` pane with a live pixel crew.
- Two crew agents, haiku-coder and haiku-scout, and the crew-overseer skill.
- A small CLI.

## What has NOT been verified

- This changelog was written from commit messages only (`git log`, subjects and bodies). The code, tests, released artefacts and the installed plugin were not read or run.
- Dates are author dates from `git log`, not release or publish dates.
- Versions 0.2.0 and 0.3.0 have no commit subject with that version, so they have no section. 0.3.0 is named only in the body of 7e80e56, whose work is folded into 0.4.0. No commit names 0.5.1.
- Commits without a version subject are folded into the next version above them in history. The tests-only commit 0574da1 is folded into 0.5.2.
- The 0.5.0, 0.4.0 and 0.1.0 commits use the subject form `HaiKrew X.Y.Z:` rather than `X.Y.Z:`, and are treated as releases.
- Feature descriptions (guards, the hook-bypass guard, the seam check, the Opus check, token limits, the band art) are taken from commit text and were not checked against behaviour.
- Numbers (token limits, the list of 46 names, the 15-minute tick, 165 of 167 runs) are copied from commit messages, not measured.
- The 0.5.2 to 0.5.5 entries are thin because their commit messages describe only wording and renames.
