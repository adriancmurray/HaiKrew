/**
 * Subset validator for the dagr v3 run file HaiKrew emits. Pure: no I/O, no imports.
 * It checks only what HaiKrew produces, not the full dagr contract.
 */

type Obj = Record<string, unknown>;
type Add = (path: string, message: string) => void;

interface Index {
  taskIds: Set<string>;
  /** Attempt id to its started_at in epoch ms (NaN when the timestamp is invalid). */
  attemptStarts: Map<string, number>;
}

const TASK_STATES = ["queued", "working", "review", "blocked", "done", "failed", "rejected", "canceled", "settled_unverified"] as const;
const ATTEMPT_STATES = ["queued", "working", "done", "failed", "rejected", "settled_unverified", "lost"] as const;
const EVIDENCE = ["reported", "heuristic", "asserted"] as const;
const CAUSES = ["sent_back", "gate_failed", "followup", "superseded"] as const;
const EVENT_TYPES = ["attempt_started", "attempt_settled", "promoted", "directive", "message_resolved", "note"] as const;
const TASK_EVENTS = ["attempt_started", "attempt_settled", "promoted"] as const;
const ATTEMPT_EVENTS = ["attempt_started", "attempt_settled"] as const;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/** Returns human-readable findings for a candidate run document. Empty when the document is valid. */
export function checkRun(doc: unknown): string[] {
  const out: string[] = [];
  const add: Add = (path, message) => {
    out.push(`${path}: ${message}`);
  };
  if (!isObj(doc)) return ["$: document must be an object"];
  checkHeader(doc, add);
  const tasks = listField(doc, "tasks", add);
  const events = listField(doc, "events", add);
  const index = indexIds(tasks, add);
  tasks.forEach((task, i) => checkTask(task, `tasks[${i}]`, index, add));
  checkDeps(tasks, index.taskIds, add);
  checkEvents(events, index, add);
  return out;
}

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isIso(v: unknown): v is string {
  return typeof v === "string" && ISO.test(v) && !Number.isNaN(Date.parse(v));
}

function isOneOf<T extends string>(v: unknown, list: readonly T[]): v is T {
  return (list as readonly unknown[]).includes(v);
}

function listField(doc: Obj, key: string, add: Add): unknown[] {
  const value = doc[key];
  if (Array.isArray(value)) return value;
  add(key, "must be an array");
  return [];
}

function checkHeader(doc: Obj, add: Add): void {
  if (doc.dagr !== 3) add("dagr", "must be 3");
  if (!isObj(doc.run)) {
    add("run", "must be an object");
  } else {
    for (const key of ["id", "title", "started_at"]) {
      if (typeof doc.run[key] !== "string") add(`run.${key}`, "must be a string");
    }
  }
  if (!isIso(doc.generated_at)) add("generated_at", "must be an ISO timestamp");
  if (doc.projects !== undefined && !Array.isArray(doc.projects)) add("projects", "must be an array when present");
}

/** Collects task and attempt ids, reporting duplicates and attempt ids that reuse a task id. */
function indexIds(tasks: unknown[], add: Add): Index {
  const index: Index = { taskIds: new Set(), attemptStarts: new Map() };
  tasks.forEach((task, i) => {
    if (!isObj(task)) return;
    const path = `tasks[${i}].id`;
    if (typeof task.id !== "string" || task.id === "") {
      add(path, "must be a non-empty string");
    } else if (index.taskIds.has(task.id)) {
      add(path, `duplicate task id "${task.id}"`);
    } else {
      index.taskIds.add(task.id);
    }
  });
  tasks.forEach((task, i) => {
    if (!isObj(task) || !Array.isArray(task.attempts)) return;
    task.attempts.forEach((attempt, j) => {
      if (!isObj(attempt) || typeof attempt.id !== "string") return;
      const path = `tasks[${i}].attempts[${j}].id`;
      const started = isIso(attempt.started_at) ? Date.parse(attempt.started_at) : NaN;
      if (index.taskIds.has(attempt.id)) {
        add(path, `attempt id "${attempt.id}" reuses a task id`);
      } else if (index.attemptStarts.has(attempt.id)) {
        add(path, `duplicate attempt id "${attempt.id}"`);
      } else {
        index.attemptStarts.set(attempt.id, started);
      }
    });
  });
  return index;
}

function checkTask(task: unknown, path: string, index: Index, add: Add): void {
  if (!isObj(task)) {
    add(path, "must be an object");
    return;
  }
  if (typeof task.title !== "string" || task.title === "") add(path, "title must be a non-empty string");
  if (!isOneOf(task.state, TASK_STATES)) add(`${path}.state`, `must be one of ${TASK_STATES.join(", ")}`);
  if (typeof task.kind !== "string" || task.kind === "") add(`${path}.kind`, "must be a non-empty string");
  if (!Array.isArray(task.deps) || !task.deps.every((d) => typeof d === "string")) {
    add(`${path}.deps`, "must be an array of task ids");
  }
  if (!Array.isArray(task.attempts)) {
    add(`${path}.attempts`, "must be an array");
    return;
  }
  task.attempts.forEach((attempt, j) => checkAttempt(attempt, `${path}.attempts[${j}]`, j, index, add));
  const latest = task.attempts.at(-1);
  const latestState = isObj(latest) ? latest.state : undefined;
  if (!projectionHolds(task.state, latestState, task.attempts.length)) {
    add(`${path}.state`, `"${String(task.state)}" does not match the latest attempt (${String(latestState)})`);
  }
}

/** A task's state projects from its latest attempt (dagr v3 rule). */
function projectionHolds(state: unknown, latest: unknown, count: number): boolean {
  switch (state) {
    case "working":
      return latest === "working";
    case "done":
    case "rejected":
    case "settled_unverified":
      return latest === state;
    case "failed":
      return latest === "failed" || latest === "lost";
    case "review":
      return count >= 1;
    case "queued":
      return latest !== "working" && latest !== "done" && latest !== "settled_unverified";
    default:
      return true;
  }
}

function checkAttempt(attempt: unknown, path: string, pos: number, index: Index, add: Add): void {
  if (!isObj(attempt)) {
    add(path, "must be an object");
    return;
  }
  if (typeof attempt.id !== "string") add(`${path}.id`, "must be a string");
  if (attempt.n !== pos + 1) add(`${path}.n`, `must be ${pos + 1}`);
  const started = isIso(attempt.started_at) ? Date.parse(attempt.started_at) : NaN;
  if (Number.isNaN(started)) add(`${path}.started_at`, "must be an ISO timestamp");
  checkCause(attempt.cause, pos, `${path}.cause`, { id: attempt.id, started }, index, add);
  if (attempt.ended_at !== undefined) {
    if (!isIso(attempt.ended_at)) add(`${path}.ended_at`, "must be an ISO timestamp");
    else if (Date.parse(attempt.ended_at) < started) add(`${path}.ended_at`, "is before started_at");
  }
  if (!isOneOf(attempt.state, ATTEMPT_STATES)) {
    add(`${path}.state`, `must be one of ${ATTEMPT_STATES.join(", ")}`);
  } else if (attempt.state === "working") {
    checkLiveness(attempt.liveness, `${path}.liveness`, add);
  } else if (attempt.state !== "queued") {
    checkOutcome(attempt, path, add);
  }
}

/**
 * The first attempt is "initial"; later ones point at an existing attempt, in any task, that did not
 * start after them. Equal start times are allowed; a self-reference is not.
 */
function checkCause(
  cause: unknown,
  pos: number,
  path: string,
  self: { id: unknown; started: number },
  index: Index,
  add: Add,
): void {
  if (!isObj(cause)) {
    add(path, "must be an object");
    return;
  }
  if (pos === 0) {
    if (cause.type !== "initial") add(`${path}.type`, 'the first attempt must be "initial"');
    return;
  }
  if (!isOneOf(cause.type, CAUSES)) {
    add(`${path}.type`, `must be one of ${CAUSES.join(", ")}`);
    return;
  }
  const ref = cause.ref;
  const refStarted = typeof ref === "string" ? index.attemptStarts.get(ref) : undefined;
  if (refStarted === undefined) {
    add(`${path}.ref`, `${JSON.stringify(ref)} is not a declared attempt`);
  } else if (ref === self.id || !(refStarted <= self.started)) {
    add(`${path}.ref`, `${JSON.stringify(ref)} is not an earlier attempt`);
  }
}

function checkLiveness(liveness: unknown, path: string, add: Add): void {
  if (!isObj(liveness)) {
    add(path, "required on a working attempt");
    return;
  }
  if (typeof liveness.prompt_acknowledged !== "boolean") add(`${path}.prompt_acknowledged`, "must be a boolean");
  if (typeof liveness.queued_input !== "number") add(`${path}.queued_input`, "must be a number");
  if (liveness.last_output_at !== undefined && !isIso(liveness.last_output_at)) {
    add(`${path}.last_output_at`, "must be an ISO timestamp");
  }
}

/** Terminal attempts are immutable and carry an outcome whose result matches the attempt state. */
function checkOutcome(attempt: Obj, path: string, add: Add): void {
  if (attempt.ended_at === undefined) add(`${path}.ended_at`, "required on a terminal attempt");
  if (!isObj(attempt.outcome)) {
    add(`${path}.outcome`, "required on a terminal attempt");
    return;
  }
  const outcome = attempt.outcome;
  if (outcome.result !== attempt.state) add(`${path}.outcome.result`, `must equal state "${String(attempt.state)}"`);
  if (outcome.evidence === "verified") {
    add(`${path}.outcome.evidence`, '"verified" is never emitted by HaiKrew');
  } else if (!isOneOf(outcome.evidence, EVIDENCE)) {
    add(`${path}.outcome.evidence`, `must be one of ${EVIDENCE.join(", ")}`);
  }
}

/** Dependencies name existing tasks other than the task itself, and form no cycle. */
function checkDeps(tasks: unknown[], taskIds: Set<string>, add: Add): void {
  const nodes = new Map<string, { index: number; deps: string[] }>();
  tasks.forEach((task, i) => {
    if (!isObj(task) || typeof task.id !== "string" || !Array.isArray(task.deps)) return;
    const id = task.id;
    const deps: string[] = [];
    for (const dep of task.deps) {
      if (typeof dep !== "string") continue;
      if (dep === id) add(`tasks[${i}].deps`, `task "${id}" depends on itself`);
      else if (!taskIds.has(dep)) add(`tasks[${i}].deps`, `"${dep}" is not a task`);
      else deps.push(dep);
    }
    nodes.set(id, { index: i, deps });
  });
  const finished = new Set<string>();
  const onStack = new Set<string>();
  const visit = (id: string): void => {
    const node = nodes.get(id);
    if (!node) return;
    onStack.add(id);
    for (const dep of node.deps) {
      if (onStack.has(dep)) add(`tasks[${node.index}].deps`, `dependency cycle through "${dep}"`);
      else if (!finished.has(dep)) visit(dep);
    }
    onStack.delete(id);
    finished.add(id);
  };
  for (const id of nodes.keys()) visit(id);
}

function checkEvents(events: unknown[], index: Index, add: Add): void {
  let last = -Infinity;
  const knownTask = (v: unknown): boolean => typeof v === "string" && index.taskIds.has(v);
  const knownAttempt = (v: unknown): boolean => typeof v === "string" && index.attemptStarts.has(v);
  events.forEach((event, i) => {
    const path = `events[${i}]`;
    if (!isObj(event)) {
      add(path, "must be an object");
      return;
    }
    if (!isIso(event.at)) {
      add(`${path}.at`, "must be an ISO timestamp");
    } else {
      const at = Date.parse(event.at);
      if (at < last) add(`${path}.at`, "is earlier than the previous event");
      last = Math.max(last, at);
    }
    if (!isOneOf(event.type, EVENT_TYPES)) add(`${path}.type`, `must be one of ${EVENT_TYPES.join(", ")}`);
    if (event.task !== undefined && !knownTask(event.task)) add(`${path}.task`, `${JSON.stringify(event.task)} is not a task`);
    if (event.attempt !== undefined && !knownAttempt(event.attempt)) {
      add(`${path}.attempt`, `${JSON.stringify(event.attempt)} is not an attempt`);
    }
    if (isOneOf(event.type, TASK_EVENTS) && typeof event.task !== "string") {
      add(`${path}.task`, `required on a ${event.type} event`);
    }
    if (isOneOf(event.type, ATTEMPT_EVENTS) && typeof event.attempt !== "string") {
      add(`${path}.attempt`, `required on a ${event.type} event`);
    }
  });
}
