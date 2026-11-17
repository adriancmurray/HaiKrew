# Codex adaptation (WIP)

This contribution packages an existing standalone HaiKrew skill for OpenAI Codex,
its standard-library Python router, and a configurable routing policy. The main
conversation scopes work, launches bounded helpers, reviews the actual changes
and runs repository checks. The Claude plugin remains a separate runtime.

This is a draft awaiting the contributor's review. No upstream review is requested
yet. The model names below are aliases exposed by the originating runtime, not a
claim that those names are available to every Codex or API account.

## Install the skill

Requires Python 3.9+ and a Codex environment with helper-agent tools. Inspect the
files before installation. Copy `codex/skills/haikrew/` to the skill location your
Codex client supports, such as `~/.agents/skills/haikrew/`. Compare and preserve
any existing installation rather than overwriting it blindly. Invoke `$haikrew`.

Before use, check the live spawn tool's supported models, efforts, fork semantics
and concurrency. Review `config/routing.json` and the `MODELS`/`EFFORTS` allowlists
in `scripts/router.py` together if your runtime differs. Supplied originating
defaults are Luna/medium for bounded tasks, Sol/medium for routine work and
Astra/high for sensitive work. There is no dynamic model discovery in this draft.

## Portable routing

Save the proposed launch envelope from the skill as `event.json`, then run:

```sh
python3 /path/to/haikrew/scripts/router.py < event.json
```

On an `allow` decision, the overseeing agent passes the full `updatedInput` object
to its advertised collaboration spawn tool. `deny` requires fixing the input or
policy; an empty response preserves inheritance. Do not pass `--log` in this mode.
Running the script produces routing data; it does not launch a model, authorize
a tool call, or establish that native interception occurred.

The optional `--config /path/to/routing.json` selects another validated policy.
Sensitive lexical cues override cheap job tags. Explicit supported choices are
kept. Full-history forks inherit and cannot include model or effort overrides
under this adapter's contract. These contracts must match the receiving tool.

## Optional native hooks

Use portable routing unless interception has been demonstrated in the receiving
local Codex runtime. The current [Codex hooks documentation](https://learn.chatgpt.com/docs/hooks)
describes `PreToolUse.updatedInput` and review/trust requirements. Cloud
orchestration does not execute local command hooks, including when a computer
performs the tool work.

For an authorized local installation, merge a matcher for the actual advertised
spawn-tool spelling into the existing hooks configuration. A representative
handler is:

```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "^(spawn_agent|collaboration[.:]+spawn_agent)$",
      "hooks": [{
        "type": "command",
        "command": "python3 /absolute/path/to/haikrew/scripts/router.py --log /absolute/existing/private-directory/routes.jsonl",
        "timeout": 5
      }]
    }]
  }
}
```

Use your installation paths and an existing private receipt directory. Preserve
other hooks and avoid duplicate registrations. This repository does not install
or enable hooks. Open `/hooks`, inspect and trust the exact definition. Do not
edit trust hashes or bypass that review.

Then verify a real no-model helper spawn, the native hook receipt and the worker's
actual model. A fixture's JSON output or a portable dispatch is insufficient.
Optional receipts contain route metadata and hashed identifiers, not task text;
they are not an authorization or security boundary.

## MacBook Minion integration

The optional [MacBook Minion skill](https://github.com/ashrocket/macbookminion/tree/main/skills/macbook-minion)
moves portable tool execution and scratch storage to compatible SSH workers.
Install and pair it through its own documented workflow. Reuse its canonical
private configuration, persistent queue, coordinator and per-worker job lock.
No Minion configuration or credentials are included here.

An overseer first defines a bounded tool job and reviews its transfer list. Using
the installed controller and a reviewed task/script/source directory:

```sh
python3 /path/to/macbook-minion/scripts/minion.py pressure
python3 /path/to/macbook-minion/scripts/minion.py route TASK.json
python3 /path/to/macbook-minion/scripts/minion.py offload SOURCE \
  --task TASK.json --script JOB.sh --owner PROJECT/SESSION_ID \
  --title 'Bounded task' --description 'Scope and expected artifacts'
```

Inspect the placement result: `local` or `defer` submits nothing. Preserve the
worker/job IDs and reconcile existing jobs before retrying a submission. Verify
exit status and checksummed returned artifacts before integrating. Keep reasoning
on the subscription agent and unknown quota readings unknown. This workflow
does not add model quota or bypass task permissions; a remote working directory
is not an OS sandbox.

## Verification and remaining work

```sh
python3 -m unittest discover -s codex/tests -v
python3 /path/to/skill-creator/scripts/quick_validate.py codex/skills/haikrew
node --test tests/*.spec.ts
```

The repository's `.haikrew/verify` is the full Claude plugin/release check; inspect
it and satisfy its prerequisites before claiming release verification. The Python
suite exercises routes, overrides, fork handling, malformed input, custom policy,
CLI behavior and receipt privacy. It makes no model or network calls.

Before promotion: the contributor reviews the diff, supported Codex deployments
and model configuration are agreed, and real native interception is demonstrated
where claimed. Automated routing tests do not prove a model ran, token savings,
a Minion run or compatibility across Codex clients. The draft adds no crew pane,
verdict ledger, plugin installation or background service to Codex.
