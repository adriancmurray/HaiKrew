# Recall: search old conversations by meaning

Status: proposal, 2026-10-13. Not built.

## Problem

Long sessions get compacted. Afterwards the main model sees only a summary. To recover a detail ("what did we decide about verdicts?") it greps the raw transcript JSONL, which only works if it guesses the exact words. Adrian wants the same recall for himself, by hand.

## Facts (measured 2026-10-13)

- Transcripts: `~/.claude/projects/*/*.jsonl`, 614 files, 1.1 GB.
- This session's transcript is 33 MB. Its user messages total about 503k characters (this includes injected notices), and the assistant's text about 342k characters. That is about 2.5% of the file; the rest is tool calls and tool output.
- Ollama runs at 127.0.0.1:11434. `embeddinggemma` returns 768-dimension vectors through `/api/embed`. Nothing needs installing, and nothing leaves the machine.

## Design

1. **What is indexed:** user messages typed by the person, assistant text blocks and subagent hand-back reports. Not tool calls, tool output, system reminders or task notifications. Tool output is most of the bulk, and it is what bloats disk.
2. **Chunks:** one message per chunk, split at paragraph breaks above about 1,500 characters. Each chunk keeps its session id, project folder, timestamp, role and line number in the JSONL, so a hit can be opened in place.
3. **Store:** one index per project folder, in `~/.claude/plugins/store/haikrew-recall/<project>.jsonl`. One line per chunk: metadata, the text, and the vector as float32 in base64. No new dependencies; cosine similarity in TypeScript. A file records the indexed byte offset per transcript, so updates only read what is new.
4. **Indexing:** `haikrew recall index [--project <folder>|--all]` from the CLI, plus a SessionStart hook that indexes the current project's new lines in the background. A failed embed call skips the chunk and is retried next time. Indexing never blocks a session.
5. **Search:**
   - `haikrew recall search "<question>" [--project] [--session] [-n 8]` from the CLI;
   - a `recall` MCP tool for agents, returning up to 8 hits as `date role session:line` plus about 300 characters of text;
   - a hybrid score: cosine similarity, plus a small bonus when the question's words appear exactly. The words matter for names like `outcome()` or `board.claims`.
6. **Pruning:**
   - `haikrew recall prune --older-than <days>`;
   - `haikrew recall reset [--project]`;
   - a setting `recall.max_mb` (default 200), with the oldest sessions dropped first when it is exceeded;
   - deleting a project folder's index file removes it completely.
7. **Settings:** `recall.enabled` (default off until measured), `recall.model` (default `embeddinggemma`), `recall.url`, `recall.max_mb`.
8. **The hand-search app:** later. The CLI covers hand search until then.

## Measure before keeping

- **Questions:** 20 questions about this session with known answers. Each answer is a line in the transcript, chosen before the index is built. Examples: "when did we hold contracts and why", "what is the warn behaviour for claims", "which embedding models are on disk".
- **Compare:** recall@5 for this tool against grep over the same text. For grep, a Haiku agent picks the search words, the way it would today.
- **Cost:** index build time and index size for this 33 MB session, then for all 614 files.
- **Keep it** if it finds more of the answers than grep and the index for all projects stays under `recall.max_mb`. This is a proposed threshold.

## What has NOT been verified

- Embedding throughput on this Mac for about 600 chunks per large session.
- Whether EmbeddingGemma ranks code identifiers well. The exact-word bonus is a guess at the fix.
- Whether the SessionStart hook can run a background job long enough in the desktop app. Late-failure detection runs a CLI command there, but that is short.
