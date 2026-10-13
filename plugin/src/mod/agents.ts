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
import { rowFor, snapshot, touched } from "./crew.ts";
import { claimBook, liveClaims, normalise } from "./claims.ts";
import type { BoardSettings } from "./claims.ts";
import { addDecision, decisionTextError, limitOf, queryText, readConflicts, readRepo, scopeRows, statusText, summaryText } from "./board.ts";
import type { Store } from "./board.ts";
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
  {
    name: "board",
    description: "The crew board. action: query (live claims, decisions and notes on absolute paths: paths; end a directory with "/"), decide (log one " +
      "line of text for paths, as a decision), status (your own crew row), summary (one screen: agents in scope, conflicts, " +
      "decisions and unattributed changes since your last summary; scope is an agent id, default your own subtree).",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["query", "decide", "status", "summary"] },
        paths: { type: "array", items: { type: "string" }, description: "Absolute paths." },
        text: { type: "string", description: "The decision, one line of at most 200 characters." },
        limit: { type: "number", description: "Most lines query returns: default 40, at most 400." },
        scope: { type: "string", description: "summary: an agent id; its subtree is summarised." },
      },
      required: ["action"],
    },
  },
];

const CHANGES = new Set(["set_setting", "add_rule", "remove_rule", "record_verdict"]);

/** Whether `tool` may run under the person's agent-control setting, or why not. */
export function allowed(settings: Settings, tool: string): string | null {
  // The board reads the crew and logs decisions; it changes no setting, rule or verdict, so agent control does not gate it.
  if (tool === "board") return null;
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

/** Folder walks past the path's own folder stop here: a path nested this deep is not a real project tree. */
const WALK_MAX = 64;

/** The absolute, normalised paths a tool call names; relative ones are dropped. */
function pathsOf(value: unknown): string[] {
  const list = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  return [...new Set(list.map((p) => normalise(String(p), "")).filter(Boolean))];
}

/** Runs git in `cwd` and returns its stdout, or "" when it fails or the surface has no process runner. */
async function gitRun($: Api, argv: string[], cwd: string): Promise<string> {
  try {
    const r = await $.process.run(argv, { cwd, timeoutMs: 15000 });
    return r.exitCode === 0 ? r.stdout : "";
  } catch {
    return "";
  }
}

/** The repo root holding `path`, walking up past folders that do not exist yet (a new file's folder); "" when none does. */
async function rootOfPath($: Api, path: string): Promise<string> {
  let dir = path.endsWith("/") ? path : path.slice(0, path.lastIndexOf("/") + 1);
  for (let i = 0; i < WALK_MAX && dir; i++) {
    const top = (await gitRun($, ["git", "rev-parse", "--show-toplevel"], dir)).trim();
    if (top) return top;
    const bare = dir.replace(/\/+$/, "");
    if (bare === "") break;
    dir = bare.slice(0, bare.lastIndexOf("/") + 1) || "/";
  }
  return "";
}

/** The paths grouped by the repo that holds them; `loose` are the paths no repo holds. */
async function groupByRoot($: Api, paths: string[]): Promise<{ roots: Map<string, string[]>; loose: string[] }> {
  const roots = new Map<string, string[]>();
  const loose: string[] = [];
  for (const p of paths) {
    const root = await rootOfPath($, p);
    if (root) roots.set(root, [...(roots.get(root) ?? []), p]);
    else loose.push(p);
  }
  return { roots, loose };
}

/** The caller's own repo root: where its spawn ran, else the session folder's repo. "" when none. */
async function callerRoot($: Api, callerId: string): Promise<string> {
  const known = claimBook.roots.get(callerId);
  if (known) return known;
  let cwd = "";
  try {
    cwd = await $.session.cwd();
  } catch {
    cwd = "";
  }
  return (await gitRun($, ["git", "rev-parse", "--show-toplevel"], cwd)).trim();
}

/** The mod store in the shape the board takes: `$` itself is not passed across an import. */
function boardStore($: Api): Store {
  return { get: (key: string) => $.store.get(key), set: (key: string, value: unknown) => $.store.set(key, value) };
}

/** The board's `board` settings as the claims module reads them. */
const boardSettings = (settings: Settings): BoardSettings => settings.board as unknown as BoardSettings;

/** Last summary time per caller (a subagent's id, or "main"); in memory, so a restart starts every caller over. */
const lastSummary = new Map<string, number>();

/** `board summary`: one screen for the caller's scope, covering what changed since its last summary. */
async function boardSummary($: Api, root: string, e: Api, callerId: string, settings: Settings, now: number): Promise<string> {
  const key = callerId || "main";
  const scope = typeof e.scope === "string" && e.scope ? e.scope : (callerId || null);
  const rows = snapshot([], now).rows;
  const scoped = scopeRows(rows, scope);
  const scopeIds = scope === null ? null : new Set(scoped.map((r) => r.id));
  const names = new Map(rows.map((r) => [r.id, r.name]));
  const files = new Map(rows.map((r) => [r.id, touched(r.id).paths] as const));
  const recent = summary(readState(await $.store.get("ledger"))).recent;
  const runs = recent.filter((r) => scopeIds === null || scopeIds.has(r.agent_id))
    .map((r) => ({ name: names.get(r.agent_id) ?? r.agent_id, unattributed: r.unattributed }));
  const decisionsOn = settings.board?.decisions !== false;
  const text = summaryText({ rows: scoped, files, scopeIds, conflicts: await readConflicts(boardStore($)),
    decisions: decisionsOn ? (await readRepo(boardStore($), root)).decisions : [], decisionsOn, runs, since: lastSummary.get(key) ?? 0 });
  lastSummary.set(key, now);
  return text;
}

/** `board query`: each repo's claims and decisions on its paths, one block per repo; paths no repo holds are named. */
async function boardQuery($: Api, e: Api, paths: string[], settings: Settings): Promise<string> {
  const limit = limitOf(e.limit);
  const decisionsOn = settings.board?.decisions !== false;
  const { roots, loose } = await groupByRoot($, paths);
  const blocks: string[] = [];
  for (const [root, own] of roots) {
    const decisions = decisionsOn ? (await readRepo(boardStore($), root)).decisions : [];
    const body = queryText(own, liveClaims(claimBook, root, boardSettings(settings)), decisions, limit);
    blocks.push(roots.size > 1 ? `repo ${root}\n${body}` : body);
  }
  for (const p of loose) blocks.push(`skipped ${p}: no git repo holds it`);
  return blocks.join("\n");
}

/** `board decide`: appends the decision to the one repo all its paths are in; the author is the caller's crew name or "main". */
async function boardDecide($: Api, e: Api, paths: string[], callerId: string, settings: Settings, now: number): Promise<{ deny: string } | { result: string }> {
  const { roots, loose } = await groupByRoot($, paths);
  if (loose.length > 0) return { deny: `No git repo holds ${loose.join(", ")}.` };
  if (roots.size !== 1) return { deny: "The paths span more than one repo; decide for one repo at a time." };
  const [root] = [...roots.keys()];
  const author = callerId ? (rowFor(callerId, now)?.name ?? callerId) : "main";
  const max = Number(settings.board?.decisions_max) || 200;
  const decision = await addDecision(boardStore($), root, { text: String(e.text ?? ""), paths, author }, max, now);
  return { result: `Recorded ${decision.id}.` };
}

/** The board tool: query, decide, status or summary for the calling agent (or the main thread when it has no agent id). */
async function boardTool(e: Api, $: Api, settings: Settings): Promise<{ deny: string } | { result: string }> {
  const action = String(e.action ?? "");
  if (!["query", "decide", "status", "summary"].includes(action)) return { deny: "The action is query, decide, status or summary." };
  const callerId = typeof e.agentId === "string" ? e.agentId : "";
  const now = Date.now();
  if (action === "status") {
    if (!callerId) return { result: "The main thread has no crew row of its own; use summary." };
    return { result: statusText(rowFor(callerId, now), touched(callerId).paths) };
  }
  if (action === "summary") {
    const root = await callerRoot($, callerId);
    if (!root) return { deny: "The board needs a git repo; run from inside one." };
    return { result: await boardSummary($, root, e, callerId, settings, now) };
  }
  const paths = pathsOf(e.paths);
  if (paths.length === 0) return { deny: "Give the absolute paths." };
  if (action === "query") return { result: await boardQuery($, e, paths, settings) };
  if (settings.board?.decisions === false) return { deny: "The decision log is off. The person can turn it on in /haikrew: Settings › Claims." };
  const error = decisionTextError(String(e.text ?? ""));
  if (error) return { deny: error };
  return boardDecide($, e, paths, callerId, settings, now);
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
      if (spec.name === "board") return boardTool(e, $, settings);
      const reply = answer(spec.name, e, settings);
      if (!reply.ok) return { deny: reply.reason };
      await $.store.set("settings", reply.settings);
      $.ui.toast(`HaiKrew: an agent ${reply.change}`);
      $.ui.invalidate("ui.render");
      return { result: `Done: ${reply.change}.` };
    });
  }
}
