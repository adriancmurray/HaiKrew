/**
 * The dagr run exporter's model: the crew's agents as tasks with attempts, kept as module state and rendered as a
 * contract-v3 document on demand. Pure: the clock comes in as `now`, and nothing is read or written here.
 */

type Obj = Record<string, unknown>;
type Phase = "running" | "awaiting_review" | "settled";
type Verdict = "pass" | "fail";
type SelfVerdict = "pass" | "fail" | "blocked" | "none";

interface Attempt {
  id: string;
  n: number;
  cause: Obj;
  actor: string;
  model: string;
  state: string;
  startedMs: number;
  endedMs: number | null;
  outcome: Obj | null;
  lastOutputMs: number | null;
  /** The reviewer attempt that rejected this one; a re-run after it is a sent_back cause. */
  rejectedBy: { id: string; name: string } | null;
  /** For a reviewer attempt: the target attempt its review lookup named. */
  bound: string | null;
}

interface Task {
  id: string;
  agentId: string;
  /** The display name; empty until a spawn names the agent. */
  name: string;
  type: string;
  description: string;
  effort: string;
  model: string;
  phase: Phase;
  deps: string[];
  attempts: Attempt[];
}

interface Located {
  task: Task;
  att: Attempt;
}

let generation = 0;
let active = false;
let runId = "";
let runTitle = "";
let runStartedMs = 0;
let tasks: Task[] = [];
let events: Obj[] = [];
let lastAtMs = 0;

const KINDS = new Map([
  ["haiku-scout", "research"],
  ["haiku-checker", "review"],
  ["sonnet-reviewer", "review"],
]);
const FAMILIES = ["haiku", "sonnet", "opus"];

/** Clears the exporter for a new session and returns the new generation. An empty cwd leaves it inactive. */
export function dagrReset(session: { id: string; cwd: string }, now: number): number {
  generation += 1;
  const base = session.cwd.split(/[\\/]/).filter((part) => part !== "").pop() ?? "";
  active = session.cwd !== "";
  runId = session.id !== "" ? `haikrew-${session.id.slice(0, 8)}` : `haikrew-${now.toString(36)}`;
  runTitle = `haikrew · ${base}`;
  tasks = [];
  events = [];
  lastAtMs = 0;
  return generation;
}

/** The current run generation; bumped by every reset so that scheduled work can tell it is stale. */
export function dagrGeneration(): number {
  return generation;
}

/** True after a reset that had a working directory. */
export function dagrActive(): boolean {
  return active;
}

/** Observes a subagent's spawn. Enriches an agent already seen rather than duplicating it. */
export function dagrSpawn(
  agentId: string,
  info: { name: string; type: string; description: string; model: string; effort?: string },
  now: number,
): void {
  if (!active) return;
  const task = findTask(agentId) ?? createTask(agentId, now);
  enrich(task, { name: info.name, type: info.type, description: info.description, model: info.model, effort: info.effort ?? "" });
}

/** A step (output false) or a tool call (output true) by a subagent: opens an attempt or refreshes liveness. */
export function dagrActivity(agentId: string, now: number, output: boolean): void {
  if (!active) return;
  const task = findTask(agentId) ?? createTask(agentId, now);
  touch(task, now, output);
}

/** A subagent's stop. Requests review, or settles the attempt from the agent's own verdict. Repeats are no-ops. */
export function dagrStop(
  agentId: string,
  stoppedAt: number,
  now: number,
  r: { name: string; type: string; model: string; selfVerdict: SelfVerdict; reviewRequested: boolean },
): void {
  if (!active) return;
  const task = findTask(agentId) ?? createTask(agentId, now);
  enrich(task, { name: r.name, type: r.type, description: task.description, model: r.model, effort: task.effort });
  if (task.phase !== "running") return;
  touch(task, now, false);
  const cur = task.attempts.at(-1);
  if (!cur) return;
  if (r.reviewRequested) {
    endAttempt(cur, stoppedAt);
    task.phase = "awaiting_review";
    return;
  }
  const self = selfSettle(r.selfVerdict);
  closeAttempt(cur, self.state, self.outcome, stoppedAt);
  task.phase = "settled";
  record("attempt_settled", now, { task: task.id, attempt: cur.id, actor: owner(task), detail: self.state });
}

/** A runtime status for an agent. Only failed and killed act: they settle its open attempt as failed. */
export function dagrLiveStatus(agentId: string, status: string, now: number): void {
  if (!active || (status !== "failed" && status !== "killed")) return;
  const task = findTask(agentId);
  const cur = task?.attempts.at(-1);
  if (!task || !cur || cur.state !== "working") return;
  closeAttempt(cur, "failed", { result: "failed", evidence: "heuristic", reason: `runtime reported ${status}` }, now);
  task.phase = "settled";
  record("attempt_settled", now, { task: task.id, attempt: cur.id, actor: owner(task), detail: "failed" });
}

/** A reviewer's successful review-packet lookup naming a target: binds the reviewer's attempt to the target. */
export function dagrBindReview(reviewerId: string, targetName: string, now: number): void {
  if (!active) return;
  const reviewer = findTask(reviewerId) ?? createTask(reviewerId, now);
  const cur = openOrFirst(reviewer, now);
  const target = uniqueNamed(targetName, reviewer.id);
  const last = target?.attempts.at(-1);
  if (!cur || !target || !last) return;
  cur.bound = last.id;
  link(reviewer, target);
}

/** A checker's verdict for a target. Settles the checker's attempt, and the target when it is still awaiting review. */
export function dagrCheckerVerdict(reviewerId: string, targetName: string, verdict: Verdict, now: number): void {
  if (!active) return;
  const reviewer = findTask(reviewerId) ?? createTask(reviewerId, now);
  const cur = openOrFirst(reviewer, now);
  if (!cur) return;
  const receipt = `VERDICT: ${verdict.toUpperCase()} for ${targetName}`;
  closeAttempt(cur, "done", { result: "done", evidence: "reported", receipt }, now);
  reviewer.phase = "settled";
  record("attempt_settled", now, { task: reviewer.id, attempt: cur.id, actor: owner(reviewer), detail: receipt });
  const target = cur.bound !== null ? locate(cur.bound) : awaitingNamed(targetName, reviewer.id);
  if (target && isAwaiting(target)) {
    link(reviewer, target.task);
    settleTarget(target, verdict, receipt, { id: cur.id, name: owner(reviewer) }, owner(reviewer), now);
  } else if (cur.bound !== null) {
    record("note", now, {
      task: reviewer.id,
      attempt: cur.id,
      actor: owner(reviewer),
      detail: `late ${verdict} verdict for ${targetName} not applied; its attempt is no longer awaiting review`,
    });
  }
}

/** An inline verdict recorded by the main agent. Settles the one awaiting target with that name, if there is one. */
export function dagrInlineVerdict(targetName: string, verdict: Verdict, now: number): void {
  if (!active) return;
  const target = awaitingNamed(targetName, "");
  if (!target) return;
  settleTarget(target, verdict, `VERDICT: ${verdict.toUpperCase()} for ${targetName}`, null, "main agent", now);
}

/** The contract-v3 document for the current run, or null when inactive or with no tasks yet. */
export function dagrDocument(now: number): Record<string, unknown> | null {
  if (!active || tasks.length === 0) return null;
  return {
    dagr: 3,
    run: { id: runId, title: runTitle, started_at: iso(runStartedMs) },
    generated_at: iso(now),
    tasks: tasks.map(renderTask),
    events: events.map((event) => ({ ...event })),
  };
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function findTask(agentId: string): Task | undefined {
  return tasks.find((task) => task.agentId === agentId);
}

function createTask(agentId: string, now: number): Task {
  if (tasks.length === 0) runStartedMs = now;
  const task: Task = {
    id: `a-${agentId.slice(0, 8)}`,
    agentId,
    name: "",
    type: "agent",
    description: "",
    effort: "",
    model: "unknown",
    phase: "running",
    deps: [],
    attempts: [],
  };
  tasks.push(task);
  return task;
}

function owner(task: Task): string {
  return task.name === "" ? "agent" : task.name;
}

function normalizeType(type: string): string {
  const colon = type.lastIndexOf(":");
  return colon >= 0 ? type.slice(colon + 1) : type;
}

function kindOf(type: string): string {
  return KINDS.get(type) ?? "impl";
}

function chipOf(model: string, effort: string): string {
  const lower = model.toLowerCase();
  const family = FAMILIES.find((f) => lower.includes(f)) ?? model.slice(0, 8);
  const base = family === "" ? "unknown" : family;
  return effort === "" ? base : `${base}·${effort}`;
}

function enrich(
  task: Task,
  f: { name: string; type: string; description: string; model: string; effort: string },
): void {
  if (f.name !== "") task.name = f.name;
  if (f.type !== "") task.type = normalizeType(f.type);
  task.description = f.description;
  task.effort = f.effort;
  task.model = chipOf(f.model, f.effort);
  const cur = task.attempts.at(-1);
  if (cur?.state === "working") {
    cur.actor = owner(task);
    cur.model = task.model;
  }
}

function record(type: string, now: number, fields: Obj): void {
  lastAtMs = Math.max(lastAtMs, now);
  events.push({ at: iso(lastAtMs), type, ...fields });
}

/** Appends an attempt. Its cause follows the previous attempt: a rejection by a reviewer, or a plain follow-up. */
function openAttempt(task: Task, now: number, output: boolean): void {
  const prev = task.attempts.at(-1);
  const cause: Obj = !prev
    ? { type: "initial" }
    : prev.rejectedBy
      ? { type: "sent_back", by: prev.rejectedBy.name, ref: prev.rejectedBy.id }
      : { type: "followup", ref: prev.id };
  const att: Attempt = {
    id: `${task.id}·a${task.attempts.length + 1}`,
    n: task.attempts.length + 1,
    cause,
    actor: owner(task),
    model: task.model,
    state: "working",
    startedMs: now,
    endedMs: null,
    outcome: null,
    lastOutputMs: output ? now : null,
    rejectedBy: null,
    bound: null,
  };
  task.attempts.push(att);
  record("attempt_started", now, { task: task.id, attempt: att.id, actor: owner(task) });
}

/**
 * A step or tool call by the agent. On an open attempt it only refreshes liveness. Otherwise it settles a
 * pending review as resumed before a verdict, then opens the next attempt.
 */
function touch(task: Task, now: number, output: boolean): void {
  const cur = task.attempts.at(-1);
  if (task.phase === "running" && cur?.state === "working") {
    if (output) cur.lastOutputMs = now;
    return;
  }
  if (cur?.state === "working") {
    const detail = "resumed before a verdict";
    closeAttempt(cur, "settled_unverified", { result: "settled_unverified", evidence: "heuristic", reason: detail }, now);
    record("attempt_settled", now, { task: task.id, attempt: cur.id, actor: owner(task), detail: "settled_unverified" });
  }
  task.phase = "running";
  openAttempt(task, now, output);
}

/** The task's open attempt, opening its first attempt when it has none. Null when the latest attempt is settled. */
function openOrFirst(task: Task, now: number): Attempt | null {
  if (task.attempts.length === 0) openAttempt(task, now, false);
  const cur = task.attempts.at(-1);
  return cur?.state === "working" ? cur : null;
}

function endAttempt(att: Attempt, at: number): void {
  if (att.endedMs === null) att.endedMs = Math.max(at, att.startedMs);
}

function closeAttempt(att: Attempt, state: string, outcome: Obj, at: number): void {
  att.state = state;
  att.outcome = outcome;
  endAttempt(att, at);
}

function selfSettle(selfVerdict: SelfVerdict): { state: string; outcome: Obj } {
  switch (selfVerdict) {
    case "pass":
      return { state: "done", outcome: { result: "done", evidence: "asserted", reason: "agent reported PASS" } };
    case "fail":
      return { state: "failed", outcome: { result: "failed", evidence: "asserted", reason: "agent reported FAIL" } };
    case "blocked":
      return { state: "failed", outcome: { result: "failed", evidence: "asserted", reason: "agent reported BLOCKED" } };
    default:
      return {
        state: "settled_unverified",
        outcome: { result: "settled_unverified", evidence: "heuristic", reason: "no completion claim; inferred from the stop" },
      };
  }
}

function sameName(a: string, b: string): boolean {
  return a !== "" && a.toLowerCase() === b.toLowerCase();
}

function locate(attemptId: string): Located | null {
  for (const task of tasks) {
    const att = task.attempts.find((a) => a.id === attemptId);
    if (att) return { task, att };
  }
  return null;
}

/** The one task named `name` other than `excludeId`, or null when none or several match. */
function uniqueNamed(name: string, excludeId: string): Task | null {
  const hits = tasks.filter((t) => t.id !== excludeId && sameName(t.name, name));
  return hits.length === 1 ? hits[0] : null;
}

/** The one awaiting-review task named `name` other than `excludeId`, with its current attempt. */
function awaitingNamed(name: string, excludeId: string): Located | null {
  const hits = tasks.filter((t) => t.id !== excludeId && t.phase === "awaiting_review" && sameName(t.name, name));
  const task = hits.length === 1 ? hits[0] : undefined;
  const att = task?.attempts.at(-1);
  return task && att ? { task, att } : null;
}

function isAwaiting(target: Located): boolean {
  return target.att.state === "working" && target.task.phase === "awaiting_review" && target.task.attempts.at(-1) === target.att;
}

function reaches(fromId: string, toId: string): boolean {
  const seen = new Set<string>();
  const queue = [fromId];
  for (let id = queue.pop(); id !== undefined; id = queue.pop()) {
    if (id === toId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    queue.push(...(tasks.find((t) => t.id === id)?.deps ?? []));
  }
  return false;
}

/** Records that the reviewer depends on the target. Self-links and cycles are not added. */
function link(reviewer: Task, target: Task): void {
  if (reviewer.id === target.id || reviewer.deps.includes(target.id) || reaches(target.id, reviewer.id)) return;
  reviewer.deps.push(target.id);
}

/** Settles an awaiting target. A rejection remembers the reviewer attempt so a later re-run is a sent_back cause. */
function settleTarget(
  target: Located,
  verdict: Verdict,
  receipt: string,
  rejectedBy: { id: string; name: string } | null,
  actor: string,
  now: number,
): void {
  const pass = verdict === "pass";
  closeAttempt(target.att, pass ? "done" : "rejected", { result: pass ? "done" : "rejected", evidence: "reported", receipt }, now);
  if (!pass) target.att.rejectedBy = rejectedBy;
  target.task.phase = "settled";
  record("attempt_settled", now, { task: target.task.id, attempt: target.att.id, actor, detail: receipt });
}

function taskState(task: Task): string {
  const cur = task.attempts.at(-1);
  if (task.phase === "awaiting_review") return "review";
  if (task.phase === "running") return cur?.state === "working" ? "working" : "queued";
  return cur?.state ?? "queued";
}

function renderTask(task: Task): Obj {
  return {
    id: task.id,
    title: `${task.type}: ${task.description}`,
    kind: kindOf(task.type),
    owner: owner(task),
    state: taskState(task),
    deps: [...task.deps],
    attempts: task.attempts.map(renderAttempt),
  };
}

function renderAttempt(att: Attempt): Obj {
  const out: Obj = {
    id: att.id,
    n: att.n,
    cause: { ...att.cause },
    actor: att.actor,
    model: att.model,
    state: att.state,
    started_at: iso(att.startedMs),
  };
  if (att.endedMs !== null) out.ended_at = iso(att.endedMs);
  if (att.outcome !== null) out.outcome = { ...att.outcome };
  if (att.state === "working") {
    out.liveness = {
      prompt_acknowledged: true,
      queued_input: 0,
      ...(att.lastOutputMs !== null ? { last_output_at: iso(att.lastOutputMs) } : {}),
    };
  }
  return out;
}
