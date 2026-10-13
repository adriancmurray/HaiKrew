# HaiKrew

![HaiKrew: a crew of small orange robots under a pixel-art title](assets/header.gif)

HaiKrew is a Claude Code mod (plugin) for token-efficient agent crews. A subagent launched without a `model` inherits the main model, so by default every helper runs on the most expensive one. HaiKrew sends code writing and research to Haiku, keeps the main model on planning and review, and shortens noisy command output with a hook instead of a model.

Unofficial community plugin; not affiliated with Anthropic.

## Install

Requirements:

- Claude Code 2.1.287 or later (for mods and `plugin test`).
- Node 22.18 or later for the CLI. It runs TypeScript directly and has no build step or dependencies.

From GitHub, inside Claude Code:

```text
/plugin marketplace add adriancmurray/HaiKrew
/plugin install haikrew@haikrew
```

The marketplace also lists `clefkit`, an optional decision backend (see [Clefkit](#clefkit-companion)).

To try a clone for one session:

```sh
claude --plugin-dir /path/to/HaiKrew/plugin
```

### Update

```text
/plugin marketplace update haikrew
```

Then restart Claude Code. From a terminal, `claude plugin update haikrew@haikrew` does the same. The pane's Update button runs that command when you press it.

## Quick start

1. Run `/haikrew`. The pane opens with the model gate switch in its header (hotkey `g`). The gate is off after install.
2. Turn the gate on. From then on, subagents launched without a model are routed (see [Model gate](#model-gate)).
3. Give the main model a task that means writing more than a few lines. With the gate on, it is asked to hand the spec to `haiku-coder`, and the Your crew card lists each working agent.

What you see:

- **The pane** has cards for Controls, Your crew, Token use, Track record, Insights and Settings; each folds to one line. The terminal shows a plain three-tab version: Home, Ledger, Settings.
- **The band** (desktop app, above the prompt) shows the crew as small Claude bots. The main agent stands larger, in its model's colour (Haiku purple, Sonnet teal, Opus orange), wearing a crown, wizard hat or cap. Hover a bot for its name and latest line; its ≡ (transcript) button opens the agent's messages in a HaiKrew pane.
- Hide the band with `band.show` set to off.

## How it works

### Model gate

- Off by default (`gate.enabled`). Turn it on with the header switch, `g`, or Settings.
- A subagent launched with no model gets one: the first matching rule in `gate.rules`, else `gate.default_model` (Haiku).
- A model the caller names is kept, unless `gate.rules_override` is on. Opus is refused unless `gate.allow_opus` is on; the refusal returns to the caller with the reason and the setting.
- Pinned agent types (`haiku-coder` by default) keep their own model. Forks inherit the parent's model, so rules do not apply to them.
- A rule's `@low` to `@max` suffix, or `gate.default_effort`, sets how hard the subagent thinks. The main conversation is never changed.
- With `gate.delegate` on (the default), a short note in the main conversation's context asks it to hand spec-able work to the crew.

### The crew

- `haiku-coder` implements a tightly written spec, runs `haikrew verify` and reports in 120 words or fewer.
- `haiku-scout` answers one research question with a short cited brief. It has web search and fetch, read-only.
- `haiku-checker` is an adversarial checker. It checks each spec item, runs the checks and tries to break the change. It is read-only on the repo.
- `sonnet-reviewer` reviews the risky hunks of a standard or deep change, runs the tests and ends with a `VERDICT` line.
- Skills: `crew-overseer` is the workflow (spec, dispatch, review by tier, verify). `bench` shows how to measure setups or models on the bench in `bench/`.
- Each subagent gets a name, from its tag line or a list, shown in the crew card and transcript.

### Review tiers

When a finished agent changes files, it gets a tier and the main conversation gets a one-line note. No tier is set when `review.enabled` is off or nothing changed.

- **Light**: only `review.light_paths` changed (docs, tests), fewer than `review.light_lines` lines, and tests not failing. The checker checks it; with `review.light_reviewer` set to `inline`, the main model glances at the diff and calls `record_verdict` instead.
- **Standard**: anything else. `sonnet-reviewer` at `review.standard_reviewer` (Sonnet, medium effort).
- **Deep**: a sensitive path, `review.deep_lines` or more lines, a job in `review.deep_jobs`, failing tests, or a model under 60% over 4 or more judged runs at that job and language. The reviewer is `review.deep_reviewer` (Sonnet, high effort). With `review.deep_inline` on, the main model reviews it itself when it is at least as strong.
- For standard and deep, the note tells the main model to launch the reviewer with `HAIKREW job=review name=<name>`. Its `VERDICT: PASS|FAIL for <name>` line sets the verdict of the run it reviewed.

### Checker

- The checker is the default light reviewer (`review.light_reviewer` is `checker`). It lists its break cases on one `BROKE` line; a case whose result names a failure counts as a defect.
- Defects are counted on the checked run. The Insights card and `haikrew analyze` show the catch rate per job, language and size.
- After `review.checker_skip_after` (15) checked light runs of one job, language and size with no defect, the checker is skipped for that kind and the main model glances instead. Every `review.checker_recheck_every`th (5) skipped run is checked again. A defect resets the skip. Setting either to 0 turns that part off.

### Ledger and insights

- One row per finished subagent: model, job, language, time, tokens and verdict. Tokens are new work (input, cache writes and output); cache reads are kept apart.
- A run is judged by the last `VERDICT:` or `STATUS: done|blocked` line of its final message. Runs with neither are unjudged and left out of pass rates.
- The newest `ledger.raw_limit` (200) rows are kept in full. Older rows fold into monthly averages, and those older than `ledger.yearly_after_months` (12) into yearly ones.
- Track record suggests a stronger model for a tagged job when Haiku or Sonnet passes under 60% over 4 or more judged runs. It suggests a cheaper model when Sonnet or Opus passes 90% or more over 8 or more, unless the model below has 4 or more judged runs of that job that pass poorly. Untagged runs get an inferred job, marked "(inferred)", which gets no rule suggestions.
- Insights picks the cheapest model that passes 80% or more over 8 or more judged runs for a job and language (Opus only when allowed). That bar is separate from the Track record thresholds above.
- A suggested rule is added to `gate.rules` only after its button is pressed twice.
- The Insights card and `haikrew analyze` show checked pass rates, late failures, escalations, tokens per accepted result and the checker catch rate.
- The ledger and review packets live in the mod's store. The mod reads no credentials and writes no other files.

### Decider (shadow mode)

- `decider.mode` is `off` by default. In `shadow`, the decider asks the endpoint at `decider.url` which model, effort and review a launch needs, and records the answer without acting on it. `decide` applies a confident answer; Opus still needs `gate.allow_opus`.
- It runs only while the model gate is on (`gate.enabled`), and only for spawns the gate left undecided: no model named by the caller, no pinned type and no matching rule.
- It sends the first 4000 characters of the task, the `HAIKREW` tag, the session folder's name and a table of past results to `<url>/v1/systemone`. Errors and timeouts leave the launch as the gate set it.
- While the mode is on, `<url>/health` is checked. A failed check shows a warning on the Decider settings card.

### Late failures

- A run that passed is flagged `late_fail` when, within `ledger.late_fail_days` (5), a later commit in the same repo touches one of its files and its message says fix, revert, bug, broke or regress.
- `haikrew late-failures [--days N]` writes the flags to `~/.claude/plugins/store/haikrew-late.json`. A SessionStart hook runs it in the background.
- The mod merges that file where it cannot run git itself, which is the desktop app. Without the file, the Insights card says detection is off.

### Update notice

- At most once every 6 hours, at session start, on the sky timer or on the first pane render, the mod reads `version` from `plugin.json` on GitHub. That is one request; nothing is sent.
- When a newer version exists, the pane shows a strip with an Update button, and the main agent says so in a speech bubble in the band.
- The button runs `claude plugin update haikrew@haikrew` when pressed, then asks for a restart. Turn the check off with `pane.update_check`.

## Settings

Settings are stored in the mod's store and apply to every session. Edit them in `/haikrew`, where rules are built from dropdowns and validated on save. Defaults are in `plugin/src/schema.ts`.

| Name | Default | What it does |
|---|---|---|
| `gate.enabled` | `false` | Turn the model gate on. |
| `gate.default_model` | `haiku` | Model for a subagent launched with none, when no rule matches. |
| `gate.rules` | `job:review=sonnet`, `job:research=haiku`, `type:Explore=haiku` | Ordered rules, first match wins: `selectors=model[@effort]`. Selectors: `job:`, `lang:`, `type:`, `desc:`, `cwd:`. |
| `gate.allow_opus` | `false` | Allow Opus subagents at all. |
| `gate.rules_override` | `false` | Let rules replace a model the caller named. |
| `gate.pinned_types` | `haiku-coder` | Agent types that keep their own model. |
| `gate.default_effort` | empty | Effort per model when no rule sets one, e.g. `sonnet=high`. |
| `gate.allow_nested` | `true` | Let a subagent start agents of its own. |
| `gate.delegate` | `true` | Add the delegation note to the main conversation's context. |
| `gate.instructions` | empty | Extra prompt text for matching subagents, as `<selectors>: <text>`. |
| `decider.mode` | `off` | `off`, `shadow` (record only) or `decide` (apply a confident pick). |
| `decider.url` | `http://127.0.0.1:8790` | Base URL of the decision endpoint. |
| `review.enabled` | `true` | Give each finished agent that changed files a review tier. |
| `review.light_reviewer` | `checker` | `checker` (haiku-checker) or `inline` (the main model glances). |
| `review.light_lines` | `60` | Light reviews need fewer changed lines than this. |
| `review.deep_lines` | `400` | Changes of at least this many lines get a deep review. |
| `review.standard_reviewer` | `sonnet@medium` | Reviewer model and effort for standard reviews. |
| `review.deep_reviewer` | `sonnet@high` | Reviewer model and effort for deep reviews. |
| `review.deep_inline` | `false` | The main model reviews deep changes itself when at least as strong. |
| `review.checker_skip_after` | `15` | Skip the checker for a light kind after this many runs with no defect. 0 never skips. |
| `review.checker_recheck_every` | `5` | While skipped, check every Nth light run. 0 never re-checks. |
| `checks.guard_hooks` | `true` | Refuse Bash commands that skip git hooks (`--no-verify`, `core.hooksPath`). |
| `checks.seam_check` | `false` | Also submit the seam reminder as a prompt when parallel agents finish. |
| `checks.token_limits` | `haiku=800000`, `sonnet=400000`, `opus=200000` | Warn when one subagent's new work passes its model's limit. |
| `checks.token_effort_scale` | `true` | Scale token limits by effort, from 0.5x (low) to 3x (max). |
| `squeeze.enabled` | `true` | Route matching build and test commands through `haikrew squeeze`. |
| `squeeze.max_lines` | `20` | Lines a squeezed summary prints. |
| `read_guard.max_lines` | `600` | Whole-file reads of longer files return an outline and ask for a range. |
| `ledger.enabled` | `true` | Record finished subagents. |
| `ledger.raw_limit` | `200` | Newest rows kept in full. |
| `ledger.late_fail_days` | `5` | Window for late-failure flags. |
| `agents.control` | `off` | What agents may do through HaiKrew's tools: `off`, `read` or `change`. Agents can never change this setting or Allow Opus. |
| `pane.update_check` | `true` | Check GitHub every 6 hours for a newer version. |
| `pane.open_on_start` | `false` | Open the pane when a session starts. |
| `band.show` | `true` | Show the crew above the prompt (desktop app). |
| `band.sky` | `live` | `live` (your clock), `dawn`, `day`, `dusk` or `night`. |
| `band.scenery` | `mountains` | `mountains`, `city`, `forest` or `hills`. |
| `band.headwear` | `crown` | The main agent's headwear: `crown`, `wizard`, `cap` or `none`. |
| `band.haiku_color`, `band.sonnet_color`, `band.opus_color` | `#9b7fc7`, `#4f9c98`, `#d97757` | Each model's colour in the band. |

The table lists the main settings. The full set is in the `settings` field of the `status` agent tool's answer (agent tools on) and on the Settings card in `/haikrew`; `gate.nested_model`, `decider.min_runs`, `squeeze.patterns` and `review.deep_jobs` are among the rest.

Example: `"job:implement+lang:rust=sonnet@high"` runs Rust implementation specs on Sonnet at high effort. `"cwd:~/projects/*=haiku"` matches any session under `~/projects`. A rule that picks Opus is refused unless `gate.allow_opus` is on.

## CLI

The CLI runs anywhere Node 22.18 or later runs. The examples use `haikrew`, the launcher in `plugin/bin/`; `node plugin/bin/haikrew.mjs` is the same.

| Command | What it does |
|---|---|
| `haikrew squeeze [--max-lines N] [--wrap PREFIX] -- <cmd...>` | Run a command, print a short verdict and keep the full log under `haikrew/logs` in the system temp folder. |
| `haikrew verify` | Run `.haikrew/verify` if present, or an inferred build and test. Prints one `VERDICT:` line. |
| `haikrew patterns check [--dir PATH] [--max-files N] [--max-lines N]` | Check a folder of `.md` pattern files against the caps (20 files, 40 lines). Exit 0 within caps, 1 on violations, 2 if the folder is missing. |
| `haikrew analyze [--store PATH]` | Print the routing analysis shown in the Insights card, as a table. |
| `haikrew late-failures [--days N]` | Flag late failures in the newest ledger store file (window 5 days by default) and write `haikrew-late.json`. |

## Clefkit (companion)

[Clefkit](https://github.com/adriancmurray/Clefkit) provides typed decisions from Clef models and is the usual backend for the decider.

1. Install it: `/plugin install clefkit@haikrew`.
2. Start a backend as its README describes: Cloudflare Workers AI through a local wrangler proxy, a SystemOne or Jev URL, or a local server.
3. Set `decider.url` to the backend's base URL, and `decider.mode` to `shadow`. The decider only asks while the model gate is on, and only for launches the gate left undecided.

The `clefkit` entry uses a `git-subdir` source with path `plugin`. That install path has not been tried against the published repository.

## Troubleshooting

- **A subagent ran on the main model.** It named a model of its own (kept unless `gate.rules_override` is on), it is a pinned type, or it is a fork, which inherits the parent's model.
- **Opus is refused.** Turn on `gate.allow_opus`, or use a rule that picks Sonnet.
- **The desktop app shows an old version.** It runs the copy cached at install. Update (see [Update](#update)), then restart the app.
- **No band, or no pane.** The band is desktop-only and needs `band.show`. The terminal shows the three-tab pane.
- **Insights says late-failure detection is off.** Run `haikrew late-failures` from a terminal. It needs at least one ledger store file, which exists once a subagent has finished, and git in the repo.
- **The Settings card warns about the decider.** The endpoint at `decider.url` did not answer `<url>/health`. Start the backend.

Known limits:

- Reviewer effort is advisory. The review note names it, but HaiKrew cannot force a reviewer to that effort.
- The gate has had one live check: an agent launched with no model ran on Haiku. Rules, effort, instructions and the seam check are covered by mod tests only.
- The read guard and squeeze are heuristics. They can truncate output a caller needed; a squeezed run's full log stays on disk.

## License

MIT. See [LICENSE](LICENSE).
