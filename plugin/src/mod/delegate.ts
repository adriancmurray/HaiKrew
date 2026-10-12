/**
 * The standing delegation request: a short note added to the CLAUDE.md text of the main conversation (the
 * `prompt.context` event) while the gate is on and `gate.delegate` is set. The gate only picks a model once an agent
 * is launched; this note is what tells the main model to launch one. It is written as the user's own request because
 * Claude Code's default is to start agents only when asked. Pure: settings in, text out.
 */
import type { GateSettings } from "./gate.ts";

/** Gate settings plus the delegation switch. */
export type DelegateSettings = GateSettings & { delegate: boolean };

const name = (m: string): string => m.charAt(0).toUpperCase() + m.slice(1);

/** The note for these settings, or "" when the gate or the switch is off. */
export function delegationNote(g: DelegateSettings): string {
  if (!g.enabled || !g.delegate) return "";
  const rules = g.rules.length ? g.rules.map((r) => `\`${r}\``).join(", ") : "none";
  return [
    "# HaiKrew: delegate to the crew (standing request from the user)",
    "I have HaiKrew's model gate on because I want work handed to cheap subagents. Treat this as my standing request to " +
      "use subagents: you do not need to ask me first, and it replaces any default against starting agents unasked.",
    "- Code to a clear spec (new modules, edits, refactors, renames, tests from a list of cases): write the spec, launch " +
      "`haiku-coder`, then verify the result yourself. Follow the crew-overseer skill. Several small agents beat one big one.",
    "- Web fact-finding: `haiku-scout`. Broad read-only code search: `Explore`.",
    "- Keep inline: design, decisions, reviewing anything security- or concurrency-sensitive, and edits of a few lines.",
    "- Start each agent prompt with a tag line, e.g. `HAIKREW job=implement lang=ts name=Katherine_JSON`, so routing rules and " +
      "the ledger can match it. Give each agent a name: a famous scientist, artist or inventor with a coding twist that suits " +
      "its task (Vincent van Go, Marie Curl, Ludwig van Buildhoven), underscores for spaces; HaiKrew picks one if you don't.",
    "- When HaiKrew posts a review note after an agent finishes, follow it: light → glance at the diff and call `record_verdict`; " +
      "standard/deep → launch the named reviewer model and effort with `HAIKREW job=review name=...`, telling it to call " +
      "`review_packet` first and to end with `VERDICT: PASS|FAIL for <name>`. Fix or re-run failed work before building on it.",
    `- Gate settings now: agents launched without a model run on ${name(g.default_model)}; ` +
      (g.allow_opus ? "Opus subagents are allowed; " : "Opus subagents are refused, so don't request them; ") +
      `routing rules (first match wins): ${rules}; ` +
      (g.allow_nested ? `agents may start their own (on ${name(g.nested_model)}).` : "agents may not start their own."),
  ].join("\n");
}

/** Context blocks with `note` appended to the CLAUDE.md block (added as one when there is none). Unchanged for "". */
export function withNote(blocks: unknown, note: string): unknown {
  if (!note || !Array.isArray(blocks)) return blocks;
  const i = blocks.findIndex((b) => b && typeof b === "object" && (b as { name?: unknown }).name === "claudeMd");
  if (i < 0) return [...blocks, { name: "claudeMd", text: note }];
  const block = blocks[i] as { text?: unknown };
  if (String(block.text ?? "").includes(note)) return blocks;
  return blocks.map((b, k) => (k === i ? { ...b, text: `${String(block.text ?? "")}\n\n${note}` } : b));
}
