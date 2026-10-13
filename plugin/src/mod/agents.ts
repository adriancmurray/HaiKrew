/**
 * Tools that let Claude and its agents read and change HaiKrew, when the person allows it in Settings › General ›
 * Agent control (off by default; "read" or "change"). Changes go through the same schema validation as the pane.
 * An agent can never change the agent-control setting and never turn Allow Opus on: those stay the person's.
 * pane.ts registers the tools at session start, or when the setting is turned on in the pane; they cannot be removed
 * mid-session, so while the setting is off every call is refused with the reason.
 */
import { SCHEMA, validate } from "../schema.ts";
import type { Settings } from "../schema.ts";
import { checkChanges, mergeChanges, settingsFrom } from "./config.ts";
import { snapshot } from "./crew.ts";
import { suggestions } from "./advice.ts";
import { isObject } from "./api.ts";
import { applyChecked, byModel, readState, summary, tokenTotals } from "./ledger.ts";
import type { LedgerState } from "./ledger.ts";
import { buildRule, KINDS, MODELS, EFFORTS, ruleSentence } from "./rules.ts";

type Api = Record<string, any>;
type Answer = { ok: true; change: string; settings: Settings } | { ok: false; reason: string };

const KIND_KEYS = KINDS.map((k) => k.key);

/** Gate settings only the person changes: whether the gate runs, which types it leaves alone, and whether rules override a named model. */
const PERSON_GATE_KEYS = ["enabled", "pinned_types", "rules_override"];

/** The tools, as `$.tool.register` takes them. Names are listed to the model as `mcp__<plugin>__<name>`. */
export const AGENT_TOOLS = [
  {
    name: "status",
    description: "HaiKrew status: whether the model gate is on, the default model, routing rules (as sentences and as stored), " +
      "all settings, agents working now, and per-model pass rate, tokens and time from the ledger, with suggested rules.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "set_setting",
    description: "Change one HaiKrew setting, validated as in the /haikrew pane. Call status first for sections, keys and current values. " +
      "Refused: anything under agents, turning gate.allow_opus on, and changing gate.enabled, gate.pinned_types or gate.rules_override.",
    inputSchema: {
      type: "object",
      properties: {
        section: { type: "string", enum: Object.keys(SCHEMA) },
        key: { type: "string" },
        value: { description: "true/false, a whole number, text, one of the choices, or a list of text, as the setting takes." },
      },
      required: ["section", "key", "value"],
    },
  },
  {
    name: "add_rule",
    description: "Add a model routing rule: when every condition matches a subagent launch, it runs on `model` (first matching rule wins). " +
      "Conditions: job and lang are the HAIKREW job= and lang= tags on a prompt's first line, type is the agent type, " +
      "desc is words in the task description, cwd is a folder glob.",
    inputSchema: {
      type: "object",
      properties: {
        conditions: { type: "array", minItems: 1, items: { type: "object", properties: {
          kind: { type: "string", enum: KIND_KEYS }, value: { type: "string" } }, required: ["kind", "value"] } },
        model: { type: "string", enum: [...MODELS] },
        effort: { type: "string", enum: ["", ...EFFORTS], description: "Empty: the agent's own effort." },
        first: { type: "boolean", description: "Put the rule first instead of last." },
      },
      required: ["conditions", "model"],
    },
  },
  {
    name: "remove_rule",
    description: "Remove a model routing rule, given exactly as status lists it under rules.stored.",
    inputSchema: { type: "object", properties: { rule: { type: "string" } }, required: ["rule"] },
  },
  {
    name: "review_packet",
    description: "The review packet HaiKrew wrote when a subagent finished: its spec, final report, files changed, test claim and " +
      "review tier. Give the agent's crew name; case does not matter.",
    inputSchema: { type: "object", properties: { agent: { type: "string" } }, required: ["agent"] },
  },
  {
    name: "record_verdict",
    description: "Record pass or fail for a finished subagent in the ledger, checked by the main agent. Use it for a light review, " +
      "after reading the diff.",
    inputSchema: {
      type: "object",
      properties: {
        agent: { type: "string" },
        verdict: { type: "string", enum: ["pass", "fail"] },
        note: { type: "string" },
      },
      required: ["agent", "verdict"],
    },
  },
];

const CHANGES = new Set(["set_setting", "add_rule", "remove_rule", "record_verdict"]);

/** Whether `tool` may run under the person's agent-control setting, or why not. */
export function allowed(settings: Settings, tool: string): string | null {
  const mode = String(settings.agents?.control ?? "off");
  if (mode === "off") return "Agent control is off. The person can allow it in /haikrew: Settings › General › Agent control.";
  if (mode === "read" && CHANGES.has(tool)) return "Agent control is read-only. The person can allow changes in /haikrew: Settings › General › Agent control.";
  return null;
}

/** What `status` returns. */
export function statusReport(settings: Settings, ledger: LedgerState, working: number): unknown {
  const models = byModel(summary(ledger).by_key);
  const rules = settings.gate.rules as string[];
  return {
    gate: { on: settings.gate.enabled, default_model: settings.gate.default_model, allow_opus: settings.gate.allow_opus },
    rules: { in_order: rules.map(ruleSentence), stored: rules },
    agents_working: working,
    ledger: models.map((m) => ({ model: m.model, runs: m.n, pass_rate: Number(m.pass_rate.toFixed(3)),
      tokens_per_run: Math.round(m.tokens_mean), seconds_per_run: Math.round(m.duration_mean) })),
    tokens_by_model: tokenTotals(ledger),
    suggested_rules: suggestions(ledger, rules),
    settings,
  };
}

/** Apply `changes` to `settings` after validation, or say why not. */
function change(settings: Settings, changes: Record<string, Record<string, unknown>>, what: string): Answer {
  const errors = checkChanges(changes);
  if (errors.length) return { ok: false, reason: errors.join("; ") };
  const next = mergeChanges(settingsFrom(settings), changes);
  return { ok: true, change: what, settings: next };
}

/** The answer to one change tool's input, from the current settings. Pure. */
export function answer(tool: string, input: Record<string, unknown>, settings: Settings): Answer {
  if (tool === "set_setting") {
    const section = String(input.section ?? "");
    const key = String(input.key ?? "");
    if (section === "agents") return { ok: false, reason: "Agent control is the person's setting; agents cannot change it." };
    if (section === "gate" && key === "allow_opus" && input.value === true) {
      return { ok: false, reason: "Only the person can allow Opus, in /haikrew: Settings › Routing." };
    }
    if (section === "gate" && PERSON_GATE_KEYS.includes(key)) {
      return { ok: false, reason: `Only the person can change gate.${key}, in /haikrew: Settings › Routing.` };
    }
    const error = validate(section, key, input.value);
    if (error) return { ok: false, reason: error };
    return change(settings, { [section]: { [key]: input.value } }, `set ${section}.${key} to ${JSON.stringify(input.value)}`);
  }
  const rules = settings.gate.rules as string[];
  if (tool === "add_rule") {
    const conds = Array.isArray(input.conditions) ? input.conditions.map((c: any) => ({ kind: String(c?.kind ?? ""), value: String(c?.value ?? "") })) : [];
    if (conds.length === 0 || conds.some((c) => !KIND_KEYS.includes(c.kind as never) || !c.value.trim())) {
      return { ok: false, reason: `conditions need a kind (${KIND_KEYS.join(", ")}) and a value each` };
    }
    const rule = buildRule(conds, String(input.model ?? ""), String(input.effort ?? ""));
    const next = input.first ? [rule, ...rules] : [...rules, rule];
    return change(settings, { gate: { rules: next } }, `added the rule "${ruleSentence(rule)}"`);
  }
  if (tool === "remove_rule") {
    const rule = String(input.rule ?? "");
    if (!rules.includes(rule)) return { ok: false, reason: `no rule "${rule}"; status lists them under rules.stored` };
    return change(settings, { gate: { rules: rules.filter((r) => r !== rule) } }, `removed the rule "${ruleSentence(rule)}"`);
  }
  return { ok: false, reason: `unknown tool ${tool}` };
}

/** The stored packet for `agent` (name matched without case), or a line naming the agents that have one. Pure. */
export function packetFor(packets: unknown, agent: string): string {
  const map: Record<string, unknown> = isObject(packets) ? packets : {};
  const names = Object.keys(map);
  const want = agent.trim().toLowerCase();
  const name = names.find((n) => n.toLowerCase() === want);
  const text = name === undefined ? undefined : map[name];
  if (typeof text === "string") return text;
  return names.length
    ? `No review packet for "${agent}". Packets exist for: ${names.join(", ")}.`
    : `No review packet for "${agent}". No agent has a packet yet.`;
}

/** review_packet reads the stored packet; record_verdict writes the main agent's verdict to the newest run of that name. */
async function reviewTool(tool: string, input: Api, $: Api): Promise<{ deny: string } | { result: string }> {
  const agent = String(input.agent ?? "").trim();
  if (tool === "review_packet") return { result: packetFor(await $.store.get("review_packets"), agent) };
  const verdict = String(input.verdict ?? "");
  if (!agent) return { deny: "Name the agent, as the crew lists it." };
  if (verdict !== "pass" && verdict !== "fail") return { deny: 'The verdict is "pass" or "fail".' };
  const state = readState(await $.store.get("ledger"));
  const next = applyChecked(state, { name: agent }, verdict, "main agent");
  // applyChecked returns the same state when no run matches; say so rather than report a verdict nobody recorded.
  if (next === state) return { deny: `No finished agent named "${agent}" in the ledger.` };
  await $.store.set("ledger", next);
  $.ui.toast(`HaiKrew: ${agent} marked ${verdict}`);
  $.ui.invalidate("ui.render");
  return { result: `Recorded ${verdict} for ${agent}.` };
}

/** Serve the tools as `mcp__<plugin>__<name>`. pane.ts registers them at session start (one hook per event). */
export function registerAgentTools(on: (...args: unknown[]) => void, plugin: string): void {
  for (const spec of AGENT_TOOLS) {
    on("tool.call", { tool: `mcp__${plugin}__${spec.name}` }, async ($: Api, e: Api) => {
      const settings = settingsFrom(await $.store.get("settings"));
      const refusal = allowed(settings, spec.name);
      if (refusal) return { deny: refusal };
      if (spec.name === "status") {
        const working = snapshot([], Date.now()).working;
        // A tool.call result is text or content blocks, never a bare object: the report goes out as JSON text.
        return { result: JSON.stringify(statusReport(settings, readState(await $.store.get("ledger")), working), null, 2) };
      }
      if (spec.name === "review_packet" || spec.name === "record_verdict") return reviewTool(spec.name, e, $);
      const reply = answer(spec.name, e, settings);
      if (!reply.ok) return { deny: reply.reason };
      await $.store.set("settings", reply.settings);
      $.ui.toast(`HaiKrew: an agent ${reply.change}`);
      $.ui.invalidate("ui.render");
      return { result: `Done: ${reply.change}.` };
    });
  }
}
