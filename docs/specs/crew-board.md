# Crew board: claims, contracts, decisions and status for parallel agents

Status: proposal, 2026-10-13. Nothing here is built. Each phase ships behind its own setting, is measured, and is removed if it does not earn its keep (see "Keep or drop").

## Problem

Parallel agents in one repo coordinate only through the director's spec text ("you own decider.ts; re-read before each edit"). On 2026-10-12 that failed three ways:
- two agents edited `plugin/hooks/register.ts` at once;
- one agent saw 15 failing tests that were another agent's half-finished edits;
- a review packet attributed another agent's files to the wrong agent.

The director (Opus) learns all state from hand-back reports, one round trip each, and every round re-reads the whole director context.

## Facts this builds on (checked 2026-10-13)

- `tool.call` events carry the calling subagent's id (register.ts:139); main-thread calls carry none (crew.ts:221). A hook can deny a call (the git-hook guard does).
- Shell writes are detected after the call succeeds, per subagent (crew.ts:240, shell-writes.ts:33). They block nothing; they feed the review tier, the packet and ledger `files`. Detected: `>`/`>>`, tee, mv, cp/install/ln, touch/rm/mkdir/truncate, `sed -i`/`perl -i`, git apply/checkout/restore/commit/mv/rm, patch, inline python/node write calls. Missed: `node script.js` (file body unread), `sh -c "... > f"`, `$VAR` targets, multi-file `sed -i` (last arg only), git reset/merge, `curl -o`.
- "Read-only" checker and reviewer agents are read-only by prompt text only; both have Bash, and no hook checks agent type on Bash (guards.ts:49).
- Ledger runs do not record whether a file came from an edit tool or a shell write.

## Phase 0: close the write gaps (prerequisite)

1. Classify Bash commands before they run, not only after: the same `shellWrites` patterns on the pre-call event, so claims (Phase 1) and read-only enforcement see writes before they happen.
2. Read-only agents: a Bash write by `haikrew:haiku-checker`, `haikrew:sonnet-reviewer` or `Explore` outside the system temp folder and the session scratchpad is denied with a one-line reason.
3. Widen detection: the command inside `sh -c`/`bash -c`, every file argument of `sed -i`, `curl -o`/`--output`, `git reset --hard`, `git merge`, `git stash pop|apply`.
4. Backstop for what patterns cannot see (`node script.js`, variables): at SubagentStop, compare `git status --porcelain` with the snapshot taken at spawn. Changed files that no live agent's events explain are recorded as `unattributed` on the board, so they surface instead of vanishing. With parallel agents this cannot assign the file to one agent; it only says "something wrote this".
5. Ledger runs record `files_by: {edit: [...], shell: [...]}`.

Test: unit cases per pattern; a fixture agent that writes via `node script.js` shows up as unattributed.

## Phase 1: claims (automatic, no agent cooperation)

A claim is `{path, holder (agent id + crew name), since, scope (director id)}`, kept per repo root.
- Declared: a spawn prompt may carry `owns=a.ts,b/` in the HAIKREW tag line. Those paths are claimed at spawn. This makes "you own X" machine-checked.
- Implicit: the first write by an agent to an unclaimed path claims it.
- Conflict: a write (edit tool or classified Bash) to a path another live agent holds, where neither agent is the other's ancestor. Setting `board.claims`: `warn` (default; the call runs and the tool result gets one line: "register.ts is held by Hedy Latemarr (ledger fixes); coordinate or leave it") | `deny` | `off`.
- Release: when the holder stops, plus a grace window (default 30 min, so a resume keeps its files), or at a commit containing the path.
- Every conflict is logged with both agents and whether the writer backed off.

Test: two fixture agents writing one file, warn and deny modes; ancestor/child writes are not conflicts; release after stop + grace.

## Phase 2: the board tool (pull, not push)

One MCP tool, `board`, so agents read only their slice:
- `board query <paths>`: claims on those paths, contracts touching them, decisions tagged with them. Capped at about 40 lines.
- `board decide "<one line>" <paths>`: append a decision.
- `board contract ...`: see Phase 3.
- `board status [blocker text]`: optional. Status is otherwise derived from the crew data HaiKrew already keeps (task, phase, files, last tool, tokens), so agents need not report it.
- `board summary [scope]`: one screen for a director. Agents in its scope with phase and blocker; conflicts since the last summary; contract drift; new decisions; unattributed writes.

The spawn prompt's lead note tells agents to call `board query` on the paths in their spec before editing. Haiku coders get the query result pre-filled into their prompt, about 40 lines, instead of a call.

What this does not do: hand-back reports still arrive one by one; the harness delivers them. The director saves by deciding from the summary and needing fewer rounds, not by skipping reports.

## Phase 3: contracts (stitching the seams)

The goal is a shared target that agents can check against, without the director re-explaining it.

A contract is `{id, file, symbol, signature, owner, consumers[], why}`.
- **Declare:** the director declares contracts in the spec (a `contracts:` block), or an agent calls `board contract add`. The signature is captured from code: the declaration lines of an exported symbol. Use a small per-language regex (ts/js, py, rust, swift) and store the text.
- **Drift:** at SubagentStop of any agent that touched the contract's file, re-capture the signature. If it changed:
  - the contract is marked drifted;
  - the review note for that agent requires the reviewer to check every consumer;
  - `board summary` lists the drift with its consumers.
- **Integrate:** a contract may name a check command, such as a type check or an integration test. `haikrew verify` runs the checks of drifted contracts.
- **Limit:** this catches signature drift (names, parameters, types) and nothing about behaviour. Behaviour goes in `why` and in the decision log. A test named in the contract is the only real behaviour check.

Test: rename a parameter in a fixture repo; the contract drifts, and the review note names the consumers. Change only a comment; there is no drift.

## Phase 4: decision log

- **Format:** one line per decision, with paths or module tags, author and time. It is append-only. New lines come from `board decide`, from the director, or from a reviewer's verdict line ("decision: ...").
- **Size:** capped at 200 live lines. Past the cap, a Haiku pass merges the oldest settled lines into a short "settled" section, and the merged originals stay in an archive file that is never read by default.
- **Reading:** `board query` returns only the decisions tagged with the queried paths.

## Tiers (sub-directors)

Any agent that starts agents is a director for its subtree:
- Its `board summary` covers its subtree.
- Its claims cover its children: siblings' children conflict, a parent and its own child do not.
- Contracts and decisions are visible to the whole tree.

Default depth: the main thread plus one tier of sub-directors. Each tier adds a context-heavy model, and that only pays when the subtree has three or more workers. A deeper tree needs a setting change.

Pushback recorded: a sub-director tier is not free. Today's Sonnet leads running Haiku crews worked because the leads had large, separable jobs (the bench integration). For a three-file fix, a second tier is pure overhead.

## Phase 5 (deferred): local embeddings

The decision is deferred until Phases 1-4 are measured.
- **What it would fix:** recall across sessions and after compaction ("what did we decide about verdicts?") without re-reading old transcripts.
- **What it would not fix:** the cost of a long live conversation. Every turn re-reads the current context, and retrieval does not shrink it. Compaction and fewer rounds are what shrink it.
- **Index scope:** hand-back reports, review packets, the decision log and session summaries, not raw transcripts. Raw transcripts are mostly tool output, and indexing them is where size grows.
- **Backends:**
  - Workers AI through the existing Clefkit proxy. No download, but the text leaves the machine.
  - A local MLX embedding model. It needs a download, which needs Adrian's OK, and disk space.
- **Store:** JSON plus cosine similarity in TypeScript, with no new dependency, which is fine for tens of thousands of items. A size cap and an age-based prune. `haikrew index prune|reset`.
- **Go condition:** directors still miss facts that the decision log should hold, measured by Phase 6 tasks failing for lack of an earlier decision.

## Pruning and removal

- **Storage:** each repo's board is one store entry (claims, contracts, decisions, conflicts), with archives beside it.
- **Settings:** `board.enabled` turns the whole board on and off. `board.claims`, `board.contracts` and `board.decisions` turn single parts off.
- **Expiry:** claims expire on their own. A contract whose symbol no longer exists is dropped at the next capture, with a note in the summary. The decision log keeps itself under its cap.
- **Commands:** `haikrew board prune` (expire, compact, drop dead contracts) and `haikrew board reset`.
- **Removing a phase:** delete its module and its setting. No other module may read board data except through `board.ts`.

## Phase 6: proving it is worth keeping

**Seams bench.** Add four tasks to `bench/`. Each is split into three parallel specs that:
- share one interface,
- edit one shared file,
- and are graded by hidden integration tests.

Run two arms, three runs each, on Haiku workers with the same director prompt:
- **A:** today's spec discipline.
- **B:** the board, with claims, contracts, decisions and summary.

Measured per run:
- integration tests passing on the first try;
- overlapping writes;
- fix rounds to green;
- director input tokens spent on orchestration;
- wall time.

**Live metrics in the ledger:**
- conflicts warned or denied, and whether the writer backed off;
- contract drifts, and whether review caught them;
- `board query` calls and the lines returned;
- decisions added and decisions returned;
- unattributed writes.

**Keep or drop (proposed thresholds, for Adrian to adjust):**
- **Claims** stay if they catch at least one real conflict in arm B, or in live use within two weeks, and never block a legitimate write in deny mode. Otherwise they go back to `off`.
- **Contracts** stay if arm B's first-try integration pass rate beats arm A's across the 12 runs. A tie does not count.
- **Decisions and summary** stay if director orchestration tokens fall in arm B with no drop in pass rate.
- **Embeddings** are not built unless the go condition above is met.

## Build order and size

| Order | Phase | Main modules | Size |
|---|---|---|---|
| 1 | Phase 0 | shell-writes.ts, guards, register.ts tool.call, crew.ts stop snapshot | small, 2 Haiku specs |
| 2 | Phase 1 | new claims.ts, register.ts hooks, settings | small, 1 spec |
| 3 | Phase 6 | bench tasks, score.sh | built before Phases 2-4 so arm A has a baseline; 1 spec |
| 4 | Phases 2 and 4 | new board.ts and board tool in agents.ts, lead note, pane summary | medium, 2 specs |
| 5 | Phase 3 | new contracts.ts with signature capture, review note hook | medium, 1-2 specs |

Each phase is reviewed once by Sonnet. Per the loop rule, a third fix round on the same module goes back to the main model.

## What has NOT been verified

- That `tool.call` can deny a Bash call before it runs for subagents in the desktop app. The git-hook guard suggests it can, but this specific path is untested there.
- That every pre-call event carries the agent id. This was read from the code; there are no typings.
- That regex signature capture is reliable enough across languages. Only TypeScript is in daily use here.
- That a three-file parallel task is enough to show a difference between arms A and B. Twelve runs per arm may be too few; the bench will show the variance.
- That the token savings in the summary are real. That is what Phase 6 is for.
