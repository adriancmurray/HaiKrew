/**
 * HaiKrew mod entry point. Claude Code calls register(on) once when the mod loads.
 * agent.spawn gates subagent models and adds settings instructions, turn.step applies a subagent's effort,
 * tool.call guards git-hook bypasses, squeezes noisy Bash and guards large Reads, and the SubagentStop hook records
 * each finished subagent in the ledger and flags the end of a parallel batch. Pure logic lives in src/mod;
 * this file is the only place that touches `$`, because the mod validator forbids passing `$` across imports.
 */
import { settingsFrom } from "../src/mod/config.ts";
import type { Api } from "../src/mod/api.ts";
import { effortFor, gate, resolveModel } from "../src/mod/gate.ts";
import type { GateSettings } from "../src/mod/gate.ts";
import { hookGuard, readGuard, squeeze } from "../src/mod/guards.ts";
import type { ChecksSettings, ReadGuardSettings, SqueezeSettings } from "../src/mod/guards.ts";
import { noteEffort, stepEffort } from "../src/mod/effort.ts";
import { noteSeamStart, noteSeamStop } from "../src/mod/seam.ts";
import { noteSpawn, noteStop, noteToolCall } from "../src/mod/crew.ts";
import { addRun, readState, runFromStop } from "../src/mod/ledger.ts";
import { registerPane } from "../src/mod/pane.ts";
import type { Settings } from "../src/schema.ts";

/** Claude Code calls this once when the mod loads, with the `on` that attaches hooks. */
export function register(on) {
  on("agent.spawn", async ($, e, next) => {
    const cfg = await loadSettings($);
    const gateCfg = cfg.gate as unknown as GateSettings;
    const cwd = await sessionCwd($);
    const choice = resolveModel(gateCfg, e, cwd);
    return gate(gateCfg, e, async (passed) => {
      const reply = await next(passed);
      noteSpawn(passed, reply, Date.now(), choice.rule);
      const id = typeof reply?.agentId === "string" ? reply.agentId : "";
      if (id) {
        const effort = effortFor(gateCfg, choice, String(reply.model ?? passed.model ?? ""));
        if (effort) noteEffort(id, effort);
        noteSeamStart(id, cwd);
      }
      return reply;
    }, cwd);
  });

  // Subagent steps only: stepEffort leaves the main loop (no agentId) and untracked agents unchanged.
  on("turn.step", async function* (_$, e, next) {
    return yield* next(stepEffort(e));
  });

  on("tool.call", async (_$, e, next) => {
    noteToolCall(e, Date.now());
    return next(e);
  });

  on("tool.call", { tool: "Bash" }, async ($, e, next) => {
    const cfg = await loadSettings($);
    return hookGuard(cfg.checks as unknown as ChecksSettings, e,
      (passed) => squeeze(cfg.squeeze as unknown as SqueezeSettings, passed, $.plugin.root, next));
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
    const seam = noteSeamStop(String(e.agent_id ?? ""));
    if (seam) {
      $.ui.log(seam);
      if ((await loadSettings($)).checks.seam_check) void $.prompt.submit({ text: seam });
    }
    return next(e);
  });

  registerPane(on);
}

/** The session's folder, or "" when Claude Code cannot say. */
async function sessionCwd($): Promise<string> {
  try {
    return await $.session.cwd();
  } catch {
    return "";
  }
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
