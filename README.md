# HaiKrew

![HaiKrew: a crew of small orange robots under a pixel-art title](assets/header.gif)

HaiKrew is a Claude Code mod (plugin) for token-efficient agent crews. The main model plans and reviews; cheaper Haiku subagents write code and do research; deterministic hooks gate which model a subagent runs on and trim noisy command output before it reaches the context.

Unofficial community plugin; not affiliated with Anthropic.

## Why

A subagent launched without a `model` inherits the main model, so every default agent runs on the most expensive model. HaiKrew routes code-writing and research to Haiku, keeps the main model on planning and review, and cuts noisy output deterministically (a hook shortens build logs; it does not ask a model to summarise them).

## What's inside

- **Model gate** (`agent.spawn`): off until you turn it on in `/haikrew` Settings. When on, it sets a model on every subagent launch that lacks one, and refuses Opus unless allowed.
- **Effort** (`turn.step`): a rule ending in `@<effort>`, or `gate.default_effort`, sets how hard a subagent thinks. Main conversation untouched.
- **Agent instructions** (`agent.spawn`): `gate.instructions` text is added to the prompt of matching subagents.
- **Hook-bypass guard** (`tool.call` on Bash): refuses `--no-verify` and `core.hooksPath` overrides.
- **Seam check** (`classic.SubagentStop`): when the last of two or more parallel agents in one folder finishes, says to run the full verify.
- **Squeeze** (`tool.call` on Bash): runs noisy commands such as `cargo test` or `xcodebuild` through `haikrew squeeze`, which prints a short verdict and keeps the full log on disk.
- **Read guard** (`tool.call` on Read): a large file read without a line range returns an outline and asks for a range.
- **Ledger** (`classic.SubagentStop`): one row per finished subagent (model, job, language, time, tokens, verdict). The newest 200 rows are kept in full; older rows fold into monthly averages, and monthly averages older than 12 months fold into yearly ones.
- **`/haikrew` pane**: four tabs. Crew, Settings, Ledger (with rule suggestions), and Tokens.
- **`haiku-coder` agent**: implements a tightly written spec.
- **`haiku-scout` agent**: answers one research question with a short cited brief.
- **`crew-overseer` skill**: the overseer workflow: write the spec, dispatch Haiku, verify.
- **CLI** (`bin/haikrew.mjs`): `squeeze`, `verify`, `patterns check`.

## What HaiKrew changes and touches

- **`agent.spawn`** (every subagent launch passes through this hook): does nothing while `gate.enabled` is off, which is the default; the launch goes on exactly as requested. Once you turn the gate on, it sets the model when the caller named none (or, with `gate.rules_override` on, when a rule matches), choosing from `gate.rules` first, then the default. Refuses Opus subagents unless `gate.allow_opus` is on. Refuses nested spawns when `gate.allow_nested` is off. Adds `gate.instructions` text to the prompt of matching subagents, under the line "Instructions from HaiKrew settings:" (empty by default). Why: cost control is the plugin's purpose, and every rule is a setting you control in `/haikrew`. It never changes Claude Code's permission mode or answers a permission prompt; a refusal comes back to the caller with the reason and the setting that caused it.
- **`turn.step`** (every model request, the main conversation's and each subagent's, passes through this hook): sets the effort of a subagent's requests when the gate chose one for it at launch (a rule's `@effort` or `gate.default_effort`). Requests of the main conversation and of other agents pass on unchanged. Nothing happens while the gate is off.
- **`tool.call`** (all tools): notes the tool name and time for the Crew tab's live roster, then passes the call on unchanged.
- **`tool.call`** on Bash: refuses a command containing `--no-verify`, `core.hooksPath=` or `-c core.hooksPath`, with a reason (`checks.guard_hooks`, on by default). Refuses a command that matches a squeeze pattern, with a message suggesting the `haikrew squeeze` command instead.
- **`tool.call`** on Read: refuses a whole-file read of a file longer than `read_guard.max_lines`, and returns an outline so the caller can ask for a range.
- **`session.start`**: registers the `/haikrew` command.
- **`command.run`** for `/haikrew` (`command.run` is also the name of the call that runs a command): opens the HaiKrew pane and returns "HaiKrew pane opened."; other commands pass through untouched.
- **`ui.render`** and **`ui.close`**: draw the HaiKrew pane and stop its animation when it closes; other panes pass through untouched.
- **`classic.SubagentStop`**: reads the finished subagent's transcript at the path Claude Code provides, to compute ledger fields. When the last of two or more agents that ran at the same time in one folder finishes, writes a reminder to run the full verify to the session log (`$.ui.log`). With `checks.seam_check` on (off by default), it also submits that reminder as a prompt (`$.prompt.submit`), which Claude Code runs once the session is idle. The prompt is exactly: `HaiKrew seam check: <n> agents ran in parallel in <folder>. Run the repo's full verify before trusting their reports.`, where `<n>` is the number of agents and `<folder>` is the session's folder. It carries no conversation text, file contents or agent output, and nothing is sent anywhere else.
- **Session folder**: `agent.spawn` reads the session's folder (`$.session.cwd()`) for `cwd:` selectors and the seam check. `~` in a selector is the `/Users/<name>` or `/home/<name>` part of that folder.
- **Ledger suggestions**: the Ledger tab suggests a rule when a job and language on one model pass less than 60% of at least 4 runs. A suggestion is added to `gate.rules` only when you press its button twice.
- **Storage**: the mod uses `$.store` only, for settings and the ledger. The mod writes no files.
- **Network**: none.
- **Programs started by the mod**: none. The squeeze command is only suggested to Claude, which runs it through its normal permission checks. When Claude runs `haikrew squeeze`, the CLI writes the full log under `haikrew/logs` in the system temp folder.
- **Session usage**: the Tokens tab shows this session's context size, rate-limit use and cost from Claude Code's `$.session.usage()`, on screen only. Nothing is stored or sent.
- **Credentials**: none read. No environment variables, keychain, or files under `~/.claude` are read by the mod or the CLI.

## Layout

The plugin bundle is in `plugin/` (manifest, hooks, mod source, CLI, agents, skills). The repository root holds this README, the license, assets, scripts, tests, and the marketplace manifest.

## Requirements

- Claude Code 2.1.287 or later (for mods and `plugin test`).
- Node 22.18 or later for the CLI. The CLI runs TypeScript directly through Node's type stripping and has no build step or dependencies.

## Install

Try it for one session, from a clone of this repository:

```sh
claude --plugin-dir /path/to/HaiKrew/plugin
```

Install from GitHub:

```text
/plugin marketplace add adriancmurray/HaiKrew
/plugin install haikrew@haikrew
```

The marketplace is named `haikrew` and lists one plugin, `haikrew`, whose source is `./plugin` in `.claude-plugin/marketplace.json`.

## Settings

Settings are kept in the mod store (`$.store`, key `settings`), not in a file. Edit them in `/haikrew`. Defaults come from `plugin/src/schema.ts`. Values are validated on save.

| Key | Default | What it does |
|---|---|---|
| `gate.enabled` | `false` | Turn the gate on. Off by default: until you turn it on, agent launches pass through unchanged. |
| `gate.default_model` | `"haiku"` | Model given to an agent launched without one. |
| `gate.allow_opus` | `false` | Allow subagents to run on Opus at all. Off: an Opus request is refused with a reason. |
| `gate.pinned_types` | `["haiku-coder"]` | Agent types whose own definition sets the model; the gate leaves them alone. |
| `gate.allow_nested` | `true` | Let a subagent start agents of its own. |
| `gate.nested_model` | `"haiku"` | Model given to an agent a subagent starts without naming one. |
| `gate.rules` | `["job:review=sonnet", "job:research=haiku", "type:Explore=haiku"]` | Ordered rules, first match wins: selectors joined by `+`, then `=haiku`, `=sonnet` or `=opus`, optionally `@low` to `@max`. Selectors: `job:<tag>`, `lang:<tag>`, `type:<agent type>`, `desc:<words>`, `cwd:<glob>`. |
| `gate.rules_override` | `false` | Let rules replace a model the caller named. |
| `gate.default_effort` | `[]` | Effort for subagents on a model when no rule sets one, e.g. `sonnet=high`. Empty: effort is left as it is. |
| `gate.instructions` | `[]` | Text added to matching subagents' prompts: `<selectors>: <text>`, entries separated by `\|` in the pane. |
| `checks.guard_hooks` | `true` | Refuse Bash commands that skip git hooks. |
| `checks.seam_check` | `false` | Also send the seam reminder as a prompt; off: it is only logged. |
| `squeeze.enabled` | `true` | Redirect matching commands. |
| `squeeze.patterns` | 7 regexes (cargo, swift, xcodebuild, pytest, npm/pnpm/yarn/bun, go, make) | Regexes matched against the start of a Bash command. |
| `squeeze.max_lines` | `20` | Most lines a summary prints. Passed to the CLI as `--max-lines`. |
| `squeeze.wrap_prefix` | `""` | Optional command prefixed to every squeezed run, e.g. a build lock wrapper. Passed to the CLI as `--wrap`. |
| `read_guard.enabled` | `true` | Turn the guard on or off. |
| `read_guard.max_lines` | `600` | Files longer than this need an offset/limit. |
| `ledger.enabled` | `true` | Record finished subagents. |
| `ledger.raw_limit` | `200` | Newest rows kept in full; older rows fold into monthly averages. |
| `ledger.yearly_after_months` | `12` | Monthly averages older than this fold into yearly ones. |
| `patterns.max_files` | `20` | Most pattern files allowed. Used by `patterns check` (or `--max-files`). |
| `patterns.max_lines` | `40` | Most lines per pattern file. Used by `patterns check` (or `--max-lines`). |

Example: `"rules": ["job:review=sonnet", "desc:migration=sonnet"]` runs a spec headed `HAIKREW job=review` on Sonnet, and any task whose description mentions "migration" on Sonnet too. `job:implement+lang:rust=sonnet@high` runs Rust implementation specs on Sonnet at high effort; `cwd:~/projects/*=haiku` matches any session under `~/projects`. A rule that picks Opus is refused unless `gate.allow_opus` is on.

## How the crew works

1. The overseer (the main model) writes a spec that fits on one screen. Its first line is the header `HAIKREW job=<word> lang=<word>`.
2. `haiku-coder` implements the spec in a worktree, runs `haikrew verify`, and reports in 120 words or fewer.
3. `haikrew verify` runs the repo's `.haikrew/verify` script if present, or an inferred build and test, and prints one `VERDICT:` line. The overseer reads that line and the risky diff hunks, not the transcript.

## Limitations

- The gate has had one live check (an agent launched with no model ran on Haiku). Per-task rules, effort, instructions and the seam check are covered by mod tests only; they have not been watched with real agents mid-run.
- The mod parts (gate, guards, ledger, pane) run only in Claude Code. The CLI (`squeeze`, `verify`, `patterns check`) runs anywhere Node 22.18 or later runs.
- The squeeze hook matches the start of a command with a regex.
- The read guard and squeeze are heuristics. They can truncate output a caller needed; the full log stays on disk for squeezed runs.

## License

MIT. See [LICENSE](LICENSE).
