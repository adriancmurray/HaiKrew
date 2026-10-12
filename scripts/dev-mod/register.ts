/**
 * Development entry for the HaiKrew pane, opened with /haikrew-dev. Copied into a mods folder by scripts/dev-mod.sh. It registers the pane and the observers the Crew
 * tab and Ledger tab read (spawns, tool calls, finished subagents), each into this copy's own store. No gate, no
 * guards, no change to any tool call, so it runs beside the installed haikrew without doubling its effects.
 */
import { noteSpawn, noteStop, noteToolCall } from "../src/mod/crew.ts";
import { settingsFrom } from "../src/mod/config.ts";
import { addRun, readState, runFromStop } from "../src/mod/ledger.ts";
import { registerPane } from "../src/mod/pane.ts";
import { registerAgentTools } from "../src/mod/agents.ts";

export function register(on) {
  on("agent.spawn", async ($, e, next) => {
    const reply = await next(e);
    noteSpawn(e, reply, Date.now());
    $.ui.invalidate("ui.render"); // crew changed: the band and pane redraw
    return reply;
  });

  on("tool.call", async (_$, e, next) => {
    noteToolCall(e, Date.now());
    return next(e);
  });

  on("classic.SubagentStop", async ($, e, next) => {
    let run = null;
    try {
      run = await recordStop($, e);
    } catch {
      // Recording never blocks a subagent from finishing.
    }
    noteStop(String(e.agent_id ?? ""), String(e.agent_type ?? ""), run?.verdict ?? null, Date.now(), run?.model ?? "");
    $.ui.invalidate("ui.render"); // crew changed: the band and pane redraw
    return next(e);
  });

  registerPane(on, "haikrew-dev");
  registerAgentTools(on, "haikrew-dev");
}

/** Append the finished subagent's run to this copy's ledger and return its verdict and model, or null when unreadable. */
async function recordStop($, e) {
  const path = typeof e.agent_transcript_path === "string" ? e.agent_transcript_path : "";
  if (!path) return null;
  let transcript;
  try {
    transcript = await $.fs.read(path);
  } catch {
    return null;
  }
  const run = runFromStop(e, transcript);
  await $.store.set("ledger", addRun(readState(await $.store.get("ledger")), run, settingsFrom(await $.store.get("settings"))));
  return { verdict: run.verdict, model: run.model };
}
