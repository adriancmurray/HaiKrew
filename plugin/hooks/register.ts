/**
 * HaiKrew mod entry point. Claude Code calls register(on) once when the mod loads.
 * agent.spawn gates subagent models, tool.call squeezes noisy Bash and guards large Reads, and the
 * SubagentStop hook records each finished subagent in the ledger. Pure logic lives in src/mod;
 * this file is the only place that touches `$`, because the mod validator forbids passing `$` across imports.
 */
import { settingsFrom } from "../src/mod/config.ts";
import type { Api } from "../src/mod/api.ts";
import { gate, resolveModel } from "../src/mod/gate.ts";
import type { GateSettings } from "../src/mod/gate.ts";
import { readGuard, squeeze } from "../src/mod/guards.ts";
import type { ReadGuardSettings, SqueezeSettings } from "../src/mod/guards.ts";
import { noteSpawn, noteStop, noteToolCall } from "../src/mod/crew.ts";
import { addRun, readState, runFromStop } from "../src/mod/ledger.ts";
import { registerPane } from "../src/mod/pane.ts";
import type { Settings } from "../src/schema.ts";

/** Claude Code calls this once when the mod loads, with the `on` that attaches hooks. */
export function register(on) {
  on("agent.spawn", async ($, e, next) => {
    const cfg = await loadSettings($);
    const gateCfg = cfg.gate as unknown as GateSettings;
    return gate(gateCfg, e, async (passed) => {
      const reply = await next(passed);
      noteSpawn(passed, reply, Date.now(), resolveModel(gateCfg, e).rule);
      return reply;
    });
  });

  on("tool.call", async (_$, e, next) => {
    noteToolCall(e, Date.now());
    return next(e);
  });

  on("tool.call", { tool: "Bash" }, async ($, e, next) => {
    const cfg = await loadSettings($);
    return squeeze(cfg.squeeze as unknown as SqueezeSettings, e, $.plugin.root, next);
  });

  on("tool.call", { tool: "Read" }, async ($, e, next) => {
    const cfg = await loadSettings($);
    const ranged = e.offset != null || e.limit != null;
    const text = cfg.read_guard.enabled && !ranged ? await readFile($, String(e.file_path || "")) : null;
    return readGuard(cfg.read_guard as unknown as ReadGuardSettings, e, text, next);
  });

  on("classic.SubagentStop", async ($, e, next) => {
    let verdict: string | null = null;
    try {
      verdict = await recordStop($, e);
    } catch {
      // The ledger never blocks a subagent from finishing.
    }
    noteStop(String(e.agent_id ?? ""), String(e.agent_type ?? ""), verdict, Date.now());
    return next(e);
  });

  registerPane(on);
}

/** Settings from the mod store, merged over defaults. */
async function loadSettings($: Api): Promise<Settings> {
  return settingsFrom(await $.store.get("settings"));
}

/** A file's text, or null when it cannot be read (missing, or over the 4 MiB limit). */
async function readFile($: Api, path: string): Promise<string | null> {
  try {
    return await $.fs.read(path);
  } catch {
    return null;
  }
}

/**
 * Append the finished subagent's run to the ledger and return its verdict. Skips (returns null) when ledger.enabled
 * is off or the transcript is unreadable.
 */
async function recordStop($: Api, e: Record<string, unknown>): Promise<string | null> {
  const cfg = await loadSettings($);
  const path = typeof e.agent_transcript_path === "string" ? e.agent_transcript_path : "";
  const transcript = cfg.ledger.enabled && path ? await readFile($, path) : null;
  if (transcript === null) return null;
  const run = runFromStop(e, transcript);
  const state = addRun(readState(await $.store.get("ledger")), run, cfg);
  await $.store.set("ledger", state);
  return run.verdict;
}
