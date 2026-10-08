/**
 * The Crew tab's model: the subagents this session started, their tool calls and their ends, merged with the
 * live agent list into roster rows. Pure: the clock and the live list come in as values. The tracking table is
 * module state for the session, fed by the hooks in hooks/register.ts.
 */
import { isObject } from "./api.ts";
import type { Input } from "./api.ts";

/** Finished agents stay on the roster this long, dimmed, before they drop. */
export const DONE_LINGER_MS = 60_000;
const LIVE_FINISHED = ["completed", "failed", "killed"];
const FAILED = ["fail", "blocked", "failed", "killed"];

type Member = {
  id: string;
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
};

/** One agent from `$.agent.list()`: only the fields the roster reads. */
export type LiveAgent = { id: string; type?: string; description?: string; status?: string; parentId?: string };

/** One roster line. `depth` is how many agents the row is nested under. */
export type Row = {
  id: string;
  depth: number;
  name: string;
  model: string;
  /** The selector of the gate rule that chose the model, e.g. "job:review"; absent when no rule did. */
  rule?: string;
  task: string;
  state: "working" | "done" | "failed";
  elapsedMs: number;
  calls: number;
  last: string;
};

/** The roster at one instant: its rows in display order, and how many are still working. */
export type Crew = { rows: Row[]; working: number };

const members = new Map<string, Member>();

/** Forget every tracked agent. Tests call this so each starts from an empty roster. */
export function resetCrew(): void {
  members.clear();
}

function member(id: string, now: number): Member {
  let m = members.get(id);
  if (!m) {
    m = {
      id, model: "", subagentType: "", description: "", parentId: null, startedAt: now,
      calls: 0, lastTool: "", lastTarget: "", endedAt: null, verdict: "", rule: "",
    };
    members.set(id, m);
  }
  return m;
}

/**
 * Remember a spawn the gate let through. `input` is what the gate passed on; `reply` is what the subagent started as;
 * `rule` is the gate rule text that chose the model, if one did.
 */
export function noteSpawn(input: Input, reply: unknown, now: number, rule?: string): void {
  if (!isObject(reply) || typeof reply.agentId !== "string" || !reply.agentId) return;
  const m = member(reply.agentId, now);
  m.model = String(reply.model ?? input.model ?? "");
  m.rule = rule ? rule.split("=")[0] : "";
  m.subagentType = String(input.subagentType ?? "");
  m.description = String(input.description ?? "");
  m.parentId = input.parentAgentId ? String(input.parentAgentId) : null;
}

/** Count a tool call made inside a subagent and keep its last tool and target. Calls on the main loop have no agentId. */
export function noteToolCall(e: Input, now: number): void {
  if (typeof e.agentId !== "string" || !e.agentId) return;
  const m = member(e.agentId, now);
  m.calls += 1;
  m.lastTool = String(e.tool ?? "");
  m.lastTarget = target(e);
}

/** A short label for what a tool call works on: a file's basename, or the first 30 characters of a command. */
export function target(e: Input): string {
  if (typeof e.file_path === "string" && e.file_path) return e.file_path.split("/").pop() ?? "";
  if (typeof e.command === "string") return e.command.slice(0, 30);
  return "";
}

/** Mark a subagent finished. `verdict` is the ledger's ("pass", "fail", "blocked", "none") or null when unknown. */
export function noteStop(id: string, type: string, verdict: string | null, now: number): void {
  if (!id) return;
  const m = member(id, now);
  if (!m.subagentType) m.subagentType = type;
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

/** The roster at `now`: tracked agents merged with the live list, finished ones past the linger dropped. */
export function snapshot(live: LiveAgent[], now: number): Crew {
  for (const a of live) mergeLive(a, now);
  for (const m of [...members.values()]) {
    if (m.endedAt !== null && now - m.endedAt > DONE_LINGER_MS) members.delete(m.id);
  }
  const rows = tree([...members.values()]).map(([m, depth]) => toRow(m, depth, now));
  return { rows, working: rows.filter((r) => r.state === "working").length };
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
    name: m.subagentType || "agent",
    model: m.model || "unknown",
    rule: m.rule || undefined,
    task: m.description,
    state,
    elapsedMs: (m.endedAt ?? now) - m.startedAt,
    calls: m.calls,
    last: [m.lastTool, m.lastTarget].filter(Boolean).join(" "),
  };
}

/** Elapsed time as m:ss, seconds rounded down. */
export function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * One roster line cut to `cols`: indent, status dot, name, model, the rule that chose it (when one did), elapsed,
 * calls, then the task and last tool.
 */
export function rowLine(r: Row, cols: number): string {
  const via = r.rule ? ` ${r.rule.slice(0, 10)}` : "";
  const head = `${"  ".repeat(r.depth)}● ${r.name.slice(0, 14).padEnd(14)} ${modelFamily(r.model).slice(0, 7).padEnd(7)}${via} ` +
    `${fmtElapsed(r.elapsedMs).padStart(5)} ${String(r.calls).padStart(3)}  `;
  const tail = [r.task, r.last].filter(Boolean).join(" · ");
  return (head + tail).slice(0, cols);
}
