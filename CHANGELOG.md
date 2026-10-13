HaiKrew is a Claude Code mod. It sets the model used for agent launches (the gate), adds squeeze and read guards on tool calls, keeps a ledger of agent runs, and shows the crew in a `/haikrew` pane. Release 0.1.0 introduced the gate, guards, ledger, pane, the haiku-coder and haiku-scout agents and the crew-overseer skill. Releases 0.4.0 to 0.5.5 added per-task model rules, rule effort and selectors, checks, ledger suggestions and a packaging change. Releases 0.6.0 to 0.6.5 redesigned the `/haikrew` pane and the band above the prompt, made the crew the default route for spec-able work, gave subagents names, set token warnings per model and added review tiers. The newest release covered here is 0.6.5, dated 2026-10-12.

## Unreleased

Lab evidence (15 tasks over three runs): two parallel Haiku coders never beat one, an adversarial checker found real defects the tests missed in most realistic tasks, and checkers sometimes hung on their own infinite-loop probes.

- Bench: the `bench/` folder holds six terse-spec tasks with hidden suites, reference solutions and `prep.sh`, `score.sh` and `refcheck.sh`; its README records setups S and C, and B (two parallel coders) as retired, with the run 3 numbers. `scripts/try.sh` runs `refcheck.sh` (about 5 s). New skill `bench` tells the main model how to launch a Sonnet lab lead to measure setups or models.
- Checker: every probe run is wrapped in a 20 s timeout (`timeout`, or `perl alarm` on macOS), and a probe that times out is reported as a finding.
- Checker stats: when a check run stops, its BROKE entries that show a defect are counted as `defects_found` on the checker's run and `checker_defects` on the checked run. The Insights card and `haikrew analyze` show the checker catch rate per job, language and size: checked runs with at least one defect, out of checked runs that have a count.
- Data-driven checker skip: new setting `review.checker_skip_after` (default 15, 0 never skips). A light change whose job, language and size has that many checked runs with no checker-found defect gets no checker (the main model glances), with the reason "checker found nothing in N runs of this kind".

## 0.6.7 — 2026-10-12

- Marketplace: a second entry, `clefkit` (typed decisions from Clef models, from `adriancmurray/Clefkit`, path `plugin`), and a README section on using it as the decider backend.
- Late failures: a run that passed is flagged `late_fail` (with `late_fail_commit`) when, within `ledger.late_fail_days` days (default 5), a later commit in the same repo touches a file it changed and its message says fix, revert, bug, broke or regress. When a run is recorded it keeps its repo root and repo-relative paths; at the first agent launch of a session the mod runs one `git log --since` per repo for runs from the last window. Older runs without those fields are skipped.
- Decider health: with `decider.mode` on, the first agent launch (then at most every 10 minutes) checks `<url>/health` with a 1.5 s timeout. A failure shows one toast and a warning line on the Decider settings card, with the command to start the server; the line clears when the check passes.
- The delegation note tells the main model to batch when it must act itself, and states a break-even rule: delegate when a step needs more than about 5 tool calls at a 200k-token context (about 10 at 100k) or would read more than about 20k tokens; prefer dedicated agent types (about 10k tokens at start against about 50k for a general-purpose agent).
- Decider features and data policy: the decider receives task features (size level and others), and `policy.ts` chooses the model from the ledger's per-bucket record (job, language, size), counting late failures against a model and exploring a cheaper pick at `explore_rate`.
- Routing analysis: `outcomes.ts` and `insights.ts` compute checked pass rates, late failures, escalations and paid tokens per accepted result; the pane has an Insights card and `haikrew analyze` prints the same as a table, with the Clef calibration (over- and under-escalated).
- New agent `haikrew:sonnet-reviewer` (Sonnet, read-only): reviews the risky hunks from the review packet, runs the tests and ends with a `VERDICT` line. Standard and deep review notes now name it as the `subagent_type`, with the model and effort the plan sets.
- A Sonnet or Opus subagent (not on a review or check job) gets a lead note while nested agents are allowed: it hands the bulk work to Haiku agents and keeps the judgment. Haiku agents, reviewers and checkers get no note.

## 0.6.6 — 2026-10-12

Fixes from a full audit (five auditors, one checker, every fix reviewed), plus a decider slot for decision models.

- Gate: a model the caller names is checked against `allow_opus` on every path, pinned agent types and forks included, in any letter case. Agents can no longer change `gate.enabled`, `gate.pinned_types` or `gate.rules_override`.
- `haikrew verify` works as a bare command: the plugin ships an extensionless `bin/haikrew` launcher. `squeeze` keeps up to 256 MiB of output, so a long passing build is no longer reported as failed.
- Verdicts: reports handed back through `SubagentHandback` are read again, so coders' STATUS and VERDICT lines count. A checker's `VERDICT: PASS|FAIL for <name>` no longer judges the checker's own run, names match however they are spelled (underscores, case, trailing text), and interrupted turns are not counted as attempts.
- Review tiers: writes made through shell commands count as changes; scratch paths, refused calls and failed calls do not; removed lines count. Deep reviews stay with the main agent when it is at least as strong as the deep reviewer. With agent tools off, review notes carry the context packet instead of naming tools. `deep_jobs` entries match by prefix (`security` covers `security-review`). Subagent names are unique within a session.
- Ledger: reads and writes are serialised, so two agents finishing together both get recorded. Output averages use live-counted runs; transcript-only output counts are lower bounds and show with "≥".
- Band: the drawing stays under the 131,072-character limit at any width and crew size (largest measured 124,869), and a "+N" mark counts agents not drawn. Model dots on the home page follow the band colours.
- `scripts/try.sh` runs every CLI spec; `scripts/release.sh` stages CHANGELOG.md and checks it for private paths.

Decider slot (off by default):

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
