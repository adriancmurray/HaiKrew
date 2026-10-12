/**
 * HaiKrew mod entry point. Claude Code calls register(on) once when the mod loads.
 * agent.spawn gates subagent models and adds settings instructions, turn.step applies a subagent's effort and
 * counts its tokens for the token warning, tool.call guards git-hook bypasses, squeezes noisy Bash and guards large
 * Reads, and the SubagentStop hook records each finished subagent in the ledger and flags the end of a parallel batch.
 * Pure logic lives in src/mod. The validator forbids passing `$` across imports, so `$` is used only here and in
 * the hooks of src/mod/pane.ts (the pane and band) and src/mod/agents.ts (the agent tools).
 */
import { settingsFrom } from "../src/mod/config.ts";
import type { Api } from "../src/mod/api.ts";
import { effortFor, gate, resolveModel } from "../src/mod/gate.ts";
import type { GateSettings } from "../src/mod/gate.ts";
import { hookGuard, readGuard, squeeze, tokenLimit } from "../src/mod/guards.ts";
import type { ChecksSettings, ReadGuardSettings, SqueezeSettings } from "../src/mod/guards.ts";
import { noteEffort, stepEffort } from "../src/mod/effort.ts";
import { noteSeamStart, noteSeamStop } from "../src/mod/seam.ts";
import { activityOf, agentModel, liveUsage, noteMainChunk, noteMainStep, noteSpawn, noteStop, noteTokens, noteToolCall, noteTurnEnd, rowFor } from "../src/mod/crew.ts";
import { addRun, combineUsage, readState, runFromStop } from "../src/mod/ledger.ts";
import { registerPane } from "../src/mod/pane.ts";
import { delegationNote, withNote } from "../src/mod/delegate.ts";
import type { DelegateSettings } from "../src/mod/delegate.ts";
import { registerAgentTools } from "../src/mod/agents.ts";
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
      $.ui.invalidate("ui.render"); // crew changed: the band and pane redraw
      const id = typeof reply?.agentId === "string" ? reply.agentId : "";
      if (id) {
        const effort = effortFor(gateCfg, choice, String(reply.model ?? passed.model ?? ""));
        if (effort) noteEffort(id, effort);
        noteSeamStart(id, cwd);
      }
      return reply;
    }, cwd);
  });

  // The main conversation's context: while the gate is on, the user's standing request to delegate (see delegate.ts).
  // Subagents are left alone, so a haiku-coder is not told to hand its work on again.
  on("prompt.context", async ($, e, next) => {
    if (e.agentId) return next(e);
    const note = delegationNote((await loadSettings($)).gate as unknown as DelegateSettings);
    return next(note ? { ...e, blocks: withNote(e.blocks, note) } : e);
  });

  // The main loop's turn is over: the main agent in the band rests, or waits on a crew still working.
  on("turn.complete", async ($, e, next) => {
    const reply = await next(e);
    noteTurnEnd(String(e.turnId ?? ""));
    $.ui.invalidate("ui.render");
    return reply;
  });

  // Subagent steps only: stepEffort leaves the main loop (no agentId) and untracked agents unchanged.
  // Each subagent step also adds its usage to the agent's running total, for the token warning.
  on("turn.step", async function* ($, e, next) {
    // A main-loop step: the main agent in the band is busy until this turn completes.
    if (!e.agentId && typeof e.turnId === "string" && noteMainStep(e.turnId)) $.ui.invalidate("ui.render");
    const stepped = stepEffort(e);
    const stream = next(stepped);
    let chunk = await stream.next();
    try {
      while (!chunk.done) {
        // The main loop's text, thinking and tool calls drive the band's lead; every chunk goes on unchanged.
        if (!e.agentId && noteMainChunk(chunk.value)) $.ui.invalidate("ui.render");
        yield chunk.value;
        chunk = await stream.next();
      }
    } finally {
      // Closed early by the consumer: close the stream beneath too, as yield* would.
      await stream.return(undefined);
    }
    const result = chunk.value;
    if (e.agentId && result?.usage) {
      // The limit is the step's model and the effort it ran with (the tracked one when stepEffort set it).
      const checks = (await loadSettings($)).checks as unknown as ChecksSettings;
      const model = typeof e.model === "string" && e.model ? e.model : agentModel(String(e.agentId));
      const limit = tokenLimit(checks, model, String(stepped.effort ?? ""));
      const { total, crossed } = noteTokens(e.agentId, result.usage, limit, Date.now());
      if (crossed) {
        $.ui.toast(`HaiKrew: a subagent passed ${total.toLocaleString("en-US")} tokens (warning at ${limit.toLocaleString("en-US")})`);
        $.ui.invalidate("ui.render");
      }
    }
    return result;
  });

  // Redraw the band only when the agent's activity (what its critter shows) changes, or when it first appears.
  on("tool.call", async ($, e, next) => {
    const now = Date.now();
    const id = typeof e.agentId === "string" ? e.agentId : "";
    const before = id ? rowFor(id, now) : undefined;
    noteToolCall(e, now);
    const after = id ? rowFor(id, now) : undefined;
    if (after && (!before || activityOf(before) !== activityOf(after))) $.ui.invalidate("ui.render");
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
    let run: { verdict: string; model: string } | null = null;
    try {
      run = await recordStop($, e);
    } catch {
      // The ledger never blocks a subagent from finishing.
    }
    noteStop(String(e.agent_id ?? ""), String(e.agent_type ?? ""), run?.verdict ?? null, Date.now(), run?.model ?? "");
    $.ui.invalidate("ui.render"); // crew changed: the band and pane redraw
    const seam = noteSeamStop(String(e.agent_id ?? ""));
    if (seam) {
      $.ui.log(seam);
      if ((await loadSettings($)).checks.seam_check) void $.prompt.submit({ text: seam });
    }
    return next(e);
  });

  registerPane(on);
  registerAgentTools(on, "haikrew");
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
 * Append the finished subagent's run to the ledger and return its verdict and model. Skips (returns null) when ledger.enabled
 * is off or the transcript is unreadable.
 */
async function recordStop($: Api, e: Record<string, unknown>): Promise<{ verdict: string; model: string } | null> {
  const cfg = await loadSettings($);
  const path = typeof e.agent_transcript_path === "string" ? e.agent_transcript_path : "";
  const transcript = cfg.ledger.enabled && path ? await readFile($, path) : null;
  if (transcript === null) return null;
  // The transcript's usage lines hold stream-start counts, so the usage counted live from each step wins when seen,
  // unless the transcript saw more input than the live count did (combineUsage).
  const parsed = runFromStop(e, transcript);
  const live = liveUsage(String(e.agent_id ?? ""));
  const run = live ? combineUsage(parsed, live) : parsed;
  const state = addRun(readState(await $.store.get("ledger")), run, cfg);
  await $.store.set("ledger", state);
  return { verdict: run.verdict, model: run.model };
}
