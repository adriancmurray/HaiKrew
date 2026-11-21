# HaiKrew → dagr run file

Status: approved approach; revised after Astra (gpt-6-astra via omp) review, 2026-11-13

## Intent

HaiKrew is the light, fast path: a few Haiku agents with no spec ceremony. bellwether is the heavy path (planned
units, worktrees, herdr panes, review gates) and already draws its run in dagr. The user wants the same live graph for
a HaiKrew crew: who is working on what, which review checks which work, what was sent back, and how sure each result
is. HaiKrew stays independent of both herdr and dagr.

## Goals

- While enabled on Claude Code's CLI surface, HaiKrew publishes a dagr contract-v3 snapshot to
  `<session cwd>/.dagr/haikrew.json`.
- Producing the file requires neither herdr nor a dagr installation. Viewing it (`dagr view .dagr/haikrew.json`, any
  terminal) is an optional, separately installed consumer.
- HaiKrew validates the subset of contract v3 it emits before replacing the published file. Contract tests cross-check
  that subset against the real dagr validator.
- Real `dagr check --strict --json` may report W204 (working attempt without locator) because HaiKrew has no herdr
  pane. Every other finding is a producer defect.
- Off by default. When disabled: no run model, timers, subprocesses, files, or feature-specific reads. (The author's fork runs it on by default; upstream keeps it off.)
- No prompts, model calls, review requests, or main-model tokens. It observes existing activity only.

## Non-goals

- Writing `.dagr/run.json` or touching any bellwether state (lock, messages). bellwether owns those.
- herdr features: `locator`, `run.orchestrator`, operator messages.
- One task per tool call. One task per subagent; tool calls only refresh liveness.
- Nested-agent projects. A subagent's own subagents are plain tasks in v1.
- The desktop app in v1: it has no process runner. The pane says "Export requires the CLI surface".
- Concurrent exporting sessions in the same workspace. The fixed path is the latest exporting session's run, not a
  per-session archive.

## Anti-goals

- Any hook slowed or failed by this feature. Hooks never await publication; errors are swallowed.
- A run file that claims more than HaiKrew knows. `verified` is never emitted.
- The main model spending tokens on it.

## Constraints found in the code

- The mod API (`plugin/src/mod/api.ts:13-23`) can read files but not write them. Writes go through `$.process.run`
  (argv only, no stdin), which exists only on the CLI surface and throws on the desktop app
  (`plugin/hooks/register.ts:265`). Existing Node-helper pattern: `transcriptIo`, `plugin/hooks/register.ts:388-398`.
- `$` cannot cross imports; pure logic lives in `src/mod`.
- Agent types can be plugin-qualified (`haikrew:haiku-checker`; `plugin/src/mod/gate.ts:79-82`,
  `plugin/src/mod/review.ts:48-49`).
- `planReview` (`plugin/hooks/register.ts:435-507`) decides a review policy and writes a packet/note; it does not know
  which reviewer agent will run. It returns early when `recordStop` returned null (ledger disabled or no transcript,
  `register.ts:403-407`).
- Inline reviews are recorded through `record_verdict` (`plugin/src/mod/agents.ts:213-233`).
- A resumed agent gets no new spawn; crew resumption is inferred from later activity (`plugin/src/mod/crew.ts:154-155`,
  `227-248`, `416-430`). Ledger `resumed` (`ledger.ts:326-359`) runs only at the next stop.
- `resetCrew` is test-only (`crew.ts:173-183`). The production session-start hook is in `plugin/src/mod/pane.ts:43-65`.
- Runtime `failed`/`killed` arrives through live-agent reconciliation (`mergeLive`, `crew.ts:499-507`), not SubagentStop.
- Settings groups are an explicit list (`plugin/src/mod/pane-settings.ts:28-33`); the existing health line is
  decider-specific (`pane-settings.ts:90`).
- dagr v3 rules that bind us: task state projects from its latest attempt; terminal attempts are immutable and retries
  append; causes point backward; terminal attempts carry `outcome` with a real tier; events append in time order;
  `generated_at` refreshes every write. Confirmed by Astra against dagr source (`herdr-swarm/src/check.rs:603-645,
  689-694`, `src/contract.rs:29-30`): a task in `review` whose latest attempt is `working` with `ended_at` and no
  outcome is valid (W204 only).

## Approaches considered

1. **Mod builds the run from its own crew events; a Node helper validates and publishes it (chosen).** Live, no model
   tokens, reuses state HaiKrew already tracks.
2. **CLI exporter from the ledger after the fact.** Simpler, works on desktop, but lags and the ledger lacks live state.
3. **The main model writes the file per dagr's producer skill.** Dropped: spends main-model tokens on every step.

The user picked 1 and added that HaiKrew must not rely on herdr. Astra's review moved validation in-house so the
feature does not rely on dagr either (the first draft called `dagr check` at runtime, which failed with dagr absent).

## Design

### Pieces

- `plugin/src/mod/dagr-run.ts` (new, pure): the exporter's run model as module state. Observation functions called
  from hooks (spawn, activity, stop, review decision, checker verdict, inline verdict, live status, session start) and
  `dagrDocument(now)` returning the v3 object. No I/O.
- `plugin/src/dagr-check.ts` (new, pure): validator for the emitted subset — identities, references, acyclic deps,
  attempt numbering and causes, task-state projection, timestamps, terminal outcomes, liveness types, event order.
  Shared by the mod (pre-flight) and the helper. Not a general dagr schema implementation.
- `haikrew dagr-publish <json>` (new CLI subcommand): runs with the session cwd; destination fixed at
  `.dagr/haikrew.json`. Validates with `dagr-check.ts`, refuses a symlinked `.dagr`, writes an exclusively created
  unique temp file in `.dagr/`, renames only after success, removes the temp file on failure. Never opens
  `.dagr/run.json` or bellwether files. Does not execute dagr. When it creates `.dagr/` itself it also writes
  `.dagr/.gitignore` (`*`), so the file never dirties the repo; an existing `.dagr/` (bellwether's) is left as is.
- Candidate JSON on argv is capped at 120 KiB (Linux `MAX_ARG_STRLEN` is 128 KiB; a spawn over it would throw and read
  as "no CLI").
- Switching the export on mid-session starts the run at the next agent launch (the spawn hook already holds settings
  and the session folder); the session id is remembered at session start either way.
- Scheduler (in `register.ts`): one pending timer, one in-flight publish, a dirty flag. The first change starts a
  `debounce_ms` timer; later changes do not move its deadline. Changes during a publish coalesce into one follow-up.
  Each candidate and callback carries a run-generation token; disabling or a new session invalidates scheduled
  callbacks. A helper already running may finish its captured snapshot.
- Settings (`schema.ts`): section `dagr` with `enabled` (bool, false) and `debounce_ms` (int, 1500, 250–10000). No
  output-path setting. `dagr` is added explicitly to the pane's settings group list.
- Pane: a dagr-specific status line in the dagr settings section shows the last publish failure (or "Export requires
  the CLI surface" on desktop, detected once, after which no more process calls are attempted).

### Mapping

- Capture run identity and cwd once per session. Run `id` = `haikrew-<first 8 of session id>` (fallback: start
  timestamp); `title` = `haikrew · <cwd basename>`; `started_at` = first observed agent. No `orchestrator`.
- Task ids are stable opaque ids derived from agent ids (`a-<first 8 of agent id>`); display names are labels
  (`owner`, `actor`). `title` = `<normalized type>: <description>`.
- Normalize plugin-qualified types (strip `<plugin>:`), then `haiku-coder` → `impl`, `haiku-scout` → `research`,
  `haiku-checker` / `sonnet-reviewer` → `review`, anything else → `impl`.
- Each task keeps an internal phase — `running`, `awaiting_review`, `settled` — plus its current attempt id. These are
  the exporter's state; it does not infer phase from task state, `ended_at` or roster membership.
- Open attempt 1 on the first observed execution; spawn metadata enriches an already-observed agent rather than
  duplicating it. `model` chip = family (`haiku`/`sonnet`/`opus`) plus `·effort` when set.
- While running, activity updates liveness: `prompt_acknowledged` true from the first observed step;
  `last_output_at` only once output or tool activity is observed; `queued_input: 0`.
- SubagentStop: capture the observation time before any async work. After the existing review decision completes:
  - review requested (external or inline) → task `review`; current attempt stays `working`, gets `ended_at`, no
    outcome; phase `awaiting_review`.
  - no review requested → settle: self PASS → `done`/`asserted`; self FAIL or blocked → `failed`/`asserted`; no
    claim (including ledger disabled / no transcript) → `settled_unverified`/`heuristic`.
- An explicitly observed runtime `failed`/`killed` live status settles an open attempt `failed`/`heuristic`. Never
  infer failure from transcript-read failure or roster expiry.
- Review binding: a review plan records intent for a target attempt; it does not identify the reviewer. A reviewer
  attempt binds to a target attempt when an existing review-packet lookup by that reviewer names the target; otherwise
  at verdict time only when the `VERDICT: PASS|FAIL for <name>` target has exactly one attempt awaiting review.
  Ambiguous or conflicting associations stay unlinked rather than settling a guessed target. The reviewer task's
  `deps` = the reviewed task; reject self-links and cycles.
- Checker verdict: settles the checker's own attempt `done`/`reported` (receipt `VERDICT: <X> for <name>`). PASS
  settles the bound, still-open target attempt `done`/`reported`; FAIL settles it `rejected`/`reported`. Keep the
  target's existing `ended_at`; append `attempt_settled` for each settled attempt (target event actor = reviewer).
- Inline `record_verdict` (successful call): actor `main agent`; settles the bound pending target the same way, with
  no checker task.
- Re-execution of a stopped agent (activity after its stop) opens one new attempt — not every SendMessage. Cause
  `sent_back` (by the reviewer, `ref` = reviewer attempt) when the previous attempt was rejected by a known reviewer
  attempt; otherwise `followup` with `ref` = the previous attempt. A previous attempt still awaiting review is first
  settled `settled_unverified`/`heuristic` ("resumed before a verdict").
- Idempotence: repeated stops and repeated verdicts for an attempt are no-ops. A late verdict never settles a newer
  attempt; if its target is already terminal, record a `note` event and leave history unchanged.
- Immutability: open attempts may gain liveness, `ended_at` and their first outcome. Terminal attempts never change.
  Events append with application-order timestamps.
- Session start (pane's session-start hook) resets the exporter and bumps the generation token. The last file is a
  last-observed snapshot, not proof its agents are alive.

## Acceptance tests

- coder → review → checker FAIL → send-back → checker PASS, earlier attempts preserved; each stage passes
  `dagr-check.ts`.
- the `review` / `working` / `ended_at` / no-outcome combination.
- inline verdicts; duplicate stops; late verdict after resume; ledger disabled / missing transcript.
- plugin-qualified agent types; resume without a new spawn.
- scheduler: sustained activity still publishes within `debounce_ms`; changes during a publish coalesce; disable or new
  session with a pending callback publishes nothing stale.
- publish helper: works with dagr absent from PATH; previous file kept on validation or write failure; symlinked
  `.dagr` refused; never touches `.dagr/run.json`.
- compatibility: when dagr is on PATH, every document from the scripted crews passes real `dagr check --strict --json`
  with only W204 findings; skipped with a visible notice otherwise. Core tests never require dagr.
