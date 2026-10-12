/**
 * The Crew tab's model: the subagents this session started, their tool calls and their ends, merged with the
 * live agent list into roster rows. Pure: the clock and the live list come in as values. The tracking table is
 * module state for the session, fed by the hooks in hooks/register.ts.
 */
import { isObject } from "./api.ts";
import type { Input } from "./api.ts";
import { nameFromTag, pickName } from "./names.ts";

/** Finished agents stay on the roster this long, dimmed, before they drop. */
export const DONE_LINGER_MS = 60_000;
const LIVE_FINISHED = ["completed", "failed", "killed"];
const FAILED = ["fail", "blocked", "failed", "killed"];

type Member = {
  id: string;
  /** The name the roster shows: the spawn's `name=` tag, else one picked for the id. */
  display: string;
  model: string;
  subagentType: string;
  description: string;
  parentId: string | null;
  startedAt: number;
  calls: number;
  lastTool: string;
  lastTarget: string;
  endedAt: number | null;
  verdict: string;
  rule: string;
  /** New work so far (input + cache writes + output), summed from each step's usage. */
  tokens: number;
  /** Each step's usage summed by kind; cache reads are kept apart from `tokens`. */
  usage: LiveUsage;
  /** Whether it has passed the per-agent token warning. */
  over: boolean;
  /** Files its Edit, Write and NotebookEdit calls changed, and an estimate of the lines it wrote. */
  paths: Set<string>;
  lines: number;
  /** Its spawn prompt, the first SPEC_MAX characters. */
  spec: string;
};

const SPEC_MAX = 4000;

/** A subagent's usage summed over its steps, as each step's final usage reports it. */
export type LiveUsage = { input: number; cacheWrite: number; cacheRead: number; output: number };

/** One agent from `$.agent.list()`: only the fields the roster reads. */
export type LiveAgent = { id: string; type?: string; description?: string; status?: string; parentId?: string };

/** One roster line. `depth` is how many agents the row is nested under. */
export type Row = {
  id: string;
  depth: number;
  /** The display name: from the spawn's `name=` tag, else picked for the agent. */
  name: string;
  /** The agent's type, e.g. "haiku-coder"; "agent" when none is known. */
  type: string;
  model: string;
  /** The selector of the gate rule that chose the model, e.g. "job:review"; absent when no rule did. */
  rule?: string;
  task: string;
  state: "working" | "done" | "failed";
  elapsedMs: number;
  calls: number;
  last: string;
  /** New work so far: input + cache writes + output. */
  tokens: number;
  /** Cache reads so far, shown apart from `tokens`. */
  cached: number;
  /** Past the per-agent token warning. */
  over: boolean;
};

/** The roster at one instant: its rows in display order, and how many are still working. */
/**
 * What the main agent (the conversation's own model) is doing: working alone, directing a working crew, waiting
 * with its turn over while the crew still works, or resting with nothing running.
 */
export type LeadState = "working" | "directing" | "waiting" | "resting";
/** What the main agent's own turn is doing: thinking, writing, a tool call sorted by what the tool does, or "other". */
export type LeadActivity = "thinking" | "writing" | "reading" | "editing" | "running" | "web" | "directing" | "other";
/** The main agent for the band: its state, its model as an id ("claude-opus-5-5") or a family ("opus"), and its activity. */
export type Lead = { state: LeadState; model: string; activity?: LeadActivity };
export type Crew = { rows: Row[]; working: number; lead?: Lead };

// The main loop's turn: set by its first step (a step with no agentId), cleared when that turn completes.
let mainTurn: string | null = null;
// What the main loop's streamed chunks show it doing; back to "other" when its turn completes.
let activity: LeadActivity = "other";

/** A main-loop step began (turn.step with no agentId): the main agent is busy with that turn. True when that is news. */
export function noteMainStep(turnId: string): boolean {
  const changed = mainTurn !== turnId;
  mainTurn = turnId;
  return changed;
}
/** A turn completed; when it is the main loop's, the main agent goes idle and its activity resets. */
export function noteTurnEnd(turnId: string): void {
  if (turnId !== mainTurn) return;
  mainTurn = null;
  activity = "other";
}

/** Which activity a tool call shows, by the tool's name. A Map so a name like "constructor" is not found on Object's prototype. */
const TOOL_ACTIVITY = new Map<string, LeadActivity>([
  ["Read", "reading"], ["Grep", "reading"], ["Glob", "reading"], ["LS", "reading"], ["NotebookRead", "reading"],
  ["Edit", "editing"], ["Write", "editing"], ["MultiEdit", "editing"], ["NotebookEdit", "editing"],
  ["Bash", "running"], ["WebSearch", "web"], ["WebFetch", "web"], ["Agent", "directing"], ["Task", "directing"],
]);

/**
 * The activity a streamed chunk shows: thinking, writing, or a tool's kind (unlisted tools, MCP ones included, are
 * "other"). Null for chunks that show none: a tool's arguments, the stop, the engine's own items.
 */
function chunkActivity(chunk: unknown): LeadActivity | null {
  if (!isObject(chunk)) return null;
  if (chunk.kind === "thinking") return "thinking";
  if (chunk.kind === "text") return "writing";
  if (chunk.kind === "tool") return TOOL_ACTIVITY.get(String(chunk.name ?? "")) ?? "other";
  return null;
}

/**
 * A chunk of the main loop's response (turn.step with no agentId) streamed: the main agent's activity becomes what the
 * chunk shows. True only when that changed it.
 */
export function noteMainChunk(chunk: unknown): boolean {
  const next = chunkActivity(chunk);
  if (next === null || next === activity) return false;
  activity = next;
  return true;
}

/** What the main agent is doing now, from its streamed chunks; "other" between turns. */
export function leadActivity(): LeadActivity {
  return activity;
}
/** The main agent's state given how many crew members work now. */
export function leadState(working: number): LeadState {
  if (mainTurn !== null) return working > 0 ? "directing" : "working";
  return working > 0 ? "waiting" : "resting";
}

const members = new Map<string, Member>();

/** Forget every tracked agent. Tests call this so each starts from an empty roster. */
export function resetCrew(): void {
  members.clear();
  mainTurn = null;
  activity = "other";
}

/** The display names the roster holds now. */
function displayNames(): Set<string> {
  return new Set([...members.values()].map((m) => m.display));
}

function member(id: string, now: number): Member {
  let m = members.get(id);
  if (!m) {
    m = {
      id, display: pickName(id, displayNames()), model: "", subagentType: "", description: "", parentId: null, startedAt: now,
      calls: 0, lastTool: "", lastTarget: "", endedAt: null, verdict: "", rule: "", tokens: 0,
      usage: { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 }, over: false, paths: new Set(), lines: 0, spec: "",
    };
    members.set(id, m);
  }
  return m;
}

/**
 * Remember a spawn the gate let through. `input` is what the gate passed on; `reply` is what the subagent started as;
 * `rule` is the gate rule text that chose the model, if one did. The prompt's `name=` tag, when it has one, names it.
 */
export function noteSpawn(input: Input, reply: unknown, now: number, rule?: string): void {
  if (!isObject(reply) || typeof reply.agentId !== "string" || !reply.agentId) return;
  const m = member(reply.agentId, now);
  const tagged = nameFromTag(input.prompt);
  if (tagged) m.display = tagged;
  m.model = String(reply.model ?? input.model ?? "");
  m.rule = rule ? rule.split("=")[0] : "";
  m.subagentType = String(input.subagentType ?? "");
  m.description = String(input.description ?? "");
  m.parentId = input.parentAgentId ? String(input.parentAgentId) : null;
  if (typeof input.prompt === "string") m.spec = input.prompt.slice(0, SPEC_MAX);
}

/**
 * A finished member that shows activity again was resumed: it works again, so its end and verdict are cleared. Claude
 * Code resumes a subagent under the same id, so its later activity is the same row, not a new one.
 */
function resume(m: Member): void {
  if (m.endedAt === null) return;
  m.endedAt = null;
  m.verdict = "";
}

/** Count a tool call made inside a subagent and keep its last tool and target. Calls on the main loop have no agentId. */
export function noteToolCall(e: Input, now: number): void {
  if (typeof e.agentId !== "string" || !e.agentId) return;
  const m = member(e.agentId, now);
  resume(m);
  m.calls += 1;
  m.lastTool = String(e.tool ?? "");
  m.lastTarget = target(e);
  noteChange(m, e);
}

const lineCount = (v: unknown): number => (typeof v === "string" && v !== "" ? v.split("\n").length : 0);

/** Record the file and the lines an Edit, MultiEdit, Write or NotebookEdit call changed. */
function noteChange(m: Member, e: Input): void {
  const tool = String(e.tool ?? "");
  let path: unknown = e.file_path;
  let lines = 0;
  if (tool === "Edit") lines = lineCount(e.new_string);
  else if (tool === "MultiEdit") lines = Array.isArray(e.edits) ? e.edits.reduce((n: number, x) => n + (isObject(x) ? lineCount(x.new_string) : 0), 0) : 0;
  else if (tool === "Write") lines = lineCount(e.content);
  else if (tool === "NotebookEdit") { path = e.notebook_path; lines = 1; }
  else return;
  if (typeof path !== "string" || !path) return;
  m.paths.add(path);
  m.lines += lines;
}

/** The files `id` changed and the estimated lines it wrote, from its tool calls. */
export function touched(id: string): { paths: string[]; lines: number } {
  const m = members.get(id);
  return { paths: m ? [...m.paths] : [], lines: m?.lines ?? 0 };
}

/** The spawn prompt of `id` (first 4000 characters), or "" when unknown. */
export function specOf(id: string): string {
  return members.get(id)?.spec ?? "";
}

/** A short label for what a tool call works on: a file's basename, or the first 30 characters of a command. */
export function target(e: Input): string {
  if (typeof e.file_path === "string" && e.file_path) return e.file_path.split("/").pop() ?? "";
  if (typeof e.command === "string") return e.command.slice(0, 30);
  return "";
}

/**
 * Add one step's usage to a subagent's running total. Returns the total and whether this step took it past `limit`
 * for the first time (never when `limit` is 0, the warning off). Steps of the main loop carry no agent id and count
 * for nobody.
 */
export function noteTokens(agentId: unknown, usage: unknown, limit: number, now: number): { total: number; crossed: boolean } {
  if (typeof agentId !== "string" || !agentId || !isObject(usage)) return { total: 0, crossed: false };
  const m = member(agentId, now);
  resume(m);
  const n = (key: string): number => (typeof usage[key] === "number" ? (usage[key] as number) : 0);
  m.usage.input += n("input_tokens");
  m.usage.cacheWrite += n("cache_creation_input_tokens");
  m.usage.cacheRead += n("cache_read_input_tokens");
  m.usage.output += n("output_tokens");
  m.tokens = m.usage.input + m.usage.cacheWrite + m.usage.output;
  const crossed = limit > 0 && !m.over && m.tokens > limit;
  if (crossed) m.over = true;
  return { total: m.tokens, crossed };
}

/** The usage counted live for `id`, or null when none of its steps were seen (it started before this session did). */
export function liveUsage(id: string): LiveUsage | null {
  const m = members.get(id);
  return m && m.tokens + m.usage.cacheRead > 0 ? { ...m.usage } : null;
}

/** The model the roster has for `id` (from its spawn or stop), or "" when none is known. */
export function agentModel(id: string): string {
  return members.get(id)?.model ?? "";
}

/**
 * Mark a subagent finished. `verdict` is the ledger's ("pass", "fail", "blocked", "none") or null when unknown;
 * `model` is the one its transcript names, kept when the spawn was not seen (so a retry knows what to step up from).
 */
export function noteStop(id: string, type: string, verdict: string | null, now: number, model = ""): void {
  if (!id) return;
  const m = member(id, now);
  if (!m.subagentType) m.subagentType = type;
  if (!m.model && model && model !== "unknown") m.model = model;
  m.endedAt = now;
  m.verdict = verdict ?? "";
}

/** The colour family of a model name: haiku, sonnet or opus by its text, unknown otherwise. */
export function modelFamily(model: string): "haiku" | "sonnet" | "opus" | "unknown" {
  const name = model.toLowerCase();
  if (name.includes("haiku")) return "haiku";
  if (name.includes("sonnet")) return "sonnet";
  if (name.includes("opus")) return "opus";
  return "unknown";
}

/** What a crew member is doing, as its drawing and the terminal's pose show it. */
export type Activity = "thinking" | "reading" | "editing" | "running" | "web" | "directing" | "done" | "failed";

/** The activity a roster row shows: its end state, else the family of its latest tool call, else thinking. */
export function activityOf(row: Row): Activity {
  if (row.state === "done" || row.state === "failed") return row.state;
  const tool = TOOL_ACTIVITY.get(row.last.split(" ")[0] ?? "");
  return tool === "reading" || tool === "editing" || tool === "running" || tool === "web" || tool === "directing" ? tool : "thinking";
}

/** The roster at `now`: tracked agents merged with the live list, finished ones past the linger dropped. */
export function snapshot(live: LiveAgent[], now: number): Crew {
  for (const a of live) mergeLive(a, now);
  for (const m of [...members.values()]) {
    if (m.endedAt !== null && now - m.endedAt > DONE_LINGER_MS) members.delete(m.id);
  }
  const rows = tree([...members.values()]).map(([m, depth]) => toRow(m, depth, now));
  return { rows, working: rows.filter((r) => r.state === "working").length };
}

/** The roster row for one tracked agent at `now`, or undefined when no spawn or call has named it yet. */
export function rowFor(id: string, now: number): Row | undefined {
  const m = members.get(id);
  return m ? toRow(m, 0, now) : undefined;
}

function mergeLive(a: LiveAgent, now: number): void {
  if (typeof a.id !== "string" || !a.id) return;
  const m = member(a.id, now);
  if (!m.subagentType) m.subagentType = a.type ?? "";
  if (!m.description) m.description = a.description ?? "";
  if (m.parentId === null && a.parentId) m.parentId = a.parentId;
  if (m.endedAt === null && a.status && LIVE_FINISHED.includes(a.status)) {
    m.endedAt = now;
    if (!m.verdict) m.verdict = a.status;
  }
}

/** Members in roster order: each root by start time, then its nested agents, one indent level per parent. */
function tree(all: Member[]): Array<[Member, number]> {
  const ids = new Set(all.map((m) => m.id));
  const childrenOf = (parent: string | null): Member[] => all
    .filter((m) => (m.parentId !== null && ids.has(m.parentId) ? m.parentId : null) === parent)
    .sort((a, b) => a.startedAt - b.startedAt);
  const out: Array<[Member, number]> = [];
  const walk = (parent: string | null, depth: number): void => {
    for (const m of childrenOf(parent)) {
      out.push([m, depth]);
      walk(m.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

function toRow(m: Member, depth: number, now: number): Row {
  const state = m.endedAt === null ? "working" : FAILED.includes(m.verdict) ? "failed" : "done";
  return {
    id: m.id,
    depth,
    name: m.display,
    type: m.subagentType || "agent",
    model: m.model || "unknown",
    rule: m.rule || undefined,
    task: m.description,
    state,
    elapsedMs: (m.endedAt ?? now) - m.startedAt,
    calls: m.calls,
    last: [m.lastTool, m.lastTarget].filter(Boolean).join(" "),
    tokens: m.tokens,
    cached: m.usage.cacheRead,
    over: m.over,
  };
}

/** Elapsed time as m:ss, seconds rounded down. */
export function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
