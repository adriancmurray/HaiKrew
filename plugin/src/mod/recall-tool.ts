/**
 * The `recall` tool. Pure: the store and the HTTP call come in through adapters, and agents.ts passes $.fs and
 * $.http.fetch, so the same search runs in the desktop app and in the CLI. Refused unless recall is on and the Ollama
 * address is loopback; transcript text never leaves the machine.
 */
import type { Settings } from "../schema.ts";
import { isLoopbackUrl } from "../recall.ts";
import { DEFAULT_HITS, formatHits, searchStore } from "../recall-search.ts";
import type { RecallFs, RecallHttp } from "../recall-search.ts";

/** Where the store is (`root`, the haikrew-recall folder under the person's home) and how to read and post. */
export type ToolEnv = { root: string; fs: RecallFs; http: RecallHttp };
/** The tool's answer: the hits as text, or the reason it was refused or failed. */
export type ToolReply = { deny: string } | { result: string };

const OFF = "Recall is off. The person can turn it on in /haikrew: Settings › Recall.";
const LOOPBACK = "recall.url must be a loopback address (127.0.0.1, ::1 or localhost).";

/** Answers a `recall` call with the best matches from the person's indexed conversations. */
export async function recallTool(e: Record<string, unknown>, settings: Settings, env: ToolEnv): Promise<ToolReply> {
  const r = settings.recall ?? {};
  if (r.enabled !== true) return { deny: OFF };
  const url = String(r.url ?? "").replace(/\/+$/, "");
  if (!isLoopbackUrl(url)) return { deny: LOOPBACK };
  const question = typeof e.question === "string" ? e.question.trim() : "";
  if (!question) return { deny: "Give the question." };
  const project = typeof e.project === "string" && e.project !== "" ? e.project : undefined;
  if (project !== undefined && !/^[A-Za-z0-9-]+$/.test(project)) {
    return { deny: "project is a folder name under ~/.claude/projects." };
  }
  try {
    const res = await searchStore({ root: env.root, url, model: String(r.model), fs: env.fs, http: env.http }, question,
      { project, n: DEFAULT_HITS });
    const text = res.hits.length > 0 ? formatHits(res.hits) : "recall: no hits";
    return { result: res.skipped > 0 ? `${text}\n(${res.skipped} unreadable line(s) or shard(s) skipped)` : text };
  } catch (err) {
    return { deny: `Recall failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}
