/**
 * The crew board: the decision log per repo root, the text `board query`, `board status` and `board summary` return, and
 * the only module that reads or writes the board's store keys. The pure functions take the clock's time as `now` and the
 * store as a parameter, so tests run with a fake store. claims.ts logs its conflicts here too, under the same key.
 */
import { isObject } from "./api.ts";
import { serial } from "./serial.ts";
import type { Conflict } from "./claims.ts";

/** The store key the board lives under: its conflict list (claims.ts) and the decision log per repo root. */
export const BOARD_KEY = "board";
/** Decisions moved out of the live log. Written here, never read by query or summary. */
export const ARCHIVE_KEY = "board-archive";
/** Longest decision text, in characters. Decisions are one line. */
export const DECISION_MAX = 200;
const CONFLICTS_MAX = 200;
const SUMMARY_LINES = 30;
const RECENT_RUNS = 5;

/** One line of the decision log: what was decided, the absolute paths it covers, who decided it, and when (epoch ms). */
export type Decision = { id: string; text: string; paths: string[]; author: string; ts: number };
/** The state of one repo root. `contracts` is a slot for the later contracts spec and stays empty. */
export type Repo = { decisions: Decision[]; archive_count: number; contracts: unknown[] };
/** The `board` store value: the conflict list claims.ts logs, and each repo root's state. */
export type BoardState = { conflicts: Conflict[]; repos: Record<string, Repo> };
/** The mod store's get and set, as the board uses them. */
export type Store = { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<void> };
/** A claim as the board reads it: a live path, its holder's name and task, and when it was taken (epoch ms). */
export type LiveClaim = { path: string; holderName: string; task: string; since: number };
/** A crew roster row as the board reads it: nesting depth, state, task, call count, last tool and elapsed time. */
export type RowLike = { id: string; depth: number; name: string; state: string; task: string; calls: number; last: string; elapsedMs: number };
/** A ledger run as the board reads it: its agent's name and the changed paths no agent's own edits explain. */
export type RunLike = { name: string; unattributed?: string[] };

/** Serialises the board's read-modify-write of the store, so decisions and conflicts never overwrite each other. */
const boardLock = serial();

/** An empty repo state. */
export function emptyRepo(): Repo {
  return { decisions: [], archive_count: 0, contracts: [] };
}

/** The `board` value as stored, with missing or malformed fields read as empty; other keys on it are kept. */
async function readBoard(store: Store): Promise<Record<string, unknown> & BoardState> {
  const raw = await store.get(BOARD_KEY);
  const base = isObject(raw) ? raw : {};
  const conflicts = Array.isArray(base.conflicts) ? (base.conflicts as Conflict[]) : [];
  const repos = isObject(base.repos) ? (base.repos as Record<string, Repo>) : {};
  return { ...base, conflicts, repos };
}

/** The state of `root`, or an empty one when it has none yet. */
export async function readRepo(store: Store, root: string): Promise<Repo> {
  const repo = (await readBoard(store)).repos[root];
  return isObject(repo) ? { ...emptyRepo(), ...repo } as Repo : emptyRepo();
}

/** The conflicts logged so far, oldest first. */
export async function readConflicts(store: Store): Promise<Conflict[]> {
  return (await readBoard(store)).conflicts;
}

/** Adds conflicts to the store's list, newest last, keeping the newest 200. */
export async function appendConflicts(store: Store, conflicts: Conflict[]): Promise<void> {
  if (conflicts.length === 0) return;
  await boardLock(async () => {
    const board = await readBoard(store);
    await store.set(BOARD_KEY, { ...board, conflicts: [...board.conflicts, ...conflicts].slice(-CONFLICTS_MAX) });
  });
}

/** Why a decision text is refused, or null when it is one line of at most DECISION_MAX characters. */
export function decisionTextError(text: string): string | null {
  const t = text.trim();
  if (!t) return "A decision needs text.";
  if (/[\r\n]/.test(t)) return "A decision is one line; put the rest in the spec.";
  if (t.length > DECISION_MAX) return `A decision is at most ${DECISION_MAX} characters; this one is ${t.length}.`;
  return null;
}

/**
 * Appends a decision to `root`'s log and returns it. Past `max` live decisions, the oldest move to the archive key and
 * `archive_count` grows. ponytail: the spec's Haiku merge pass into a "settled" section is not built; archiving is the
 * whole of the cap. The archive is written before the log shrinks, so a failed write leaves a duplicate, never a loss.
 */
export async function addDecision(store: Store, root: string, input: { text: string; paths: string[]; author: string }, max: number, now: number): Promise<Decision> {
  return boardLock(async () => {
    const board = await readBoard(store);
    const repo: Repo = { ...emptyRepo(), ...(board.repos[root] ?? {}) };
    const id = `D${repo.archive_count + repo.decisions.length + 1}`;
    const decision: Decision = { id, text: input.text.trim(), paths: input.paths, author: input.author, ts: now };
    repo.decisions = [...repo.decisions, decision];
    const over = repo.decisions.length - Math.max(1, max);
    if (over > 0) {
      const moved = repo.decisions.slice(0, over);
      await appendArchive(store, moved.map((d) => ({ root, ...d })));
      repo.decisions = repo.decisions.slice(over);
      repo.archive_count += moved.length;
    }
    await store.set(BOARD_KEY, { ...board, repos: { ...board.repos, [root]: repo } });
    return decision;
  });
}

/** Appends archived decisions (each tagged with its root) to the archive key. */
async function appendArchive(store: Store, items: unknown[]): Promise<void> {
  const raw = await store.get(ARCHIVE_KEY);
  const list = isObject(raw) && Array.isArray(raw.decisions) ? raw.decisions : [];
  await store.set(ARCHIVE_KEY, { decisions: [...list, ...items] });
}

/** `epoch ms` as "YYYY-MM-DD HH:MM" in UTC, the form the board prints. */
export function stamp(ts: number): string {
  return new Date(ts).toISOString().slice(0, 16).replace("T", " ");
}

/** Whether `entry` is `path`, or a directory entry (ending in "/") above it. */
export function covers(entry: string, path: string): boolean {
  return entry === path || (entry.endsWith("/") && path.startsWith(entry));
}

/** Whether two paths overlap: one covers the other, so a folder query reaches the files beneath it. */
function overlaps(a: string, b: string): boolean {
  return covers(a, b) || covers(b, a);
}

/** The line limit a query asked for: a whole number from 1 to 400, 40 when none is given or it is not a number. */
export function limitOf(value: unknown): number {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) ? Math.min(400, Math.max(1, n)) : 40;
}

/**
 * The board's answer for `paths`, one item per line, ranked: live claims on those paths, then decisions naming one of
 * them, then decisions on a parent directory of one. Newest first within each group. More than `limit` items end with
 * a line saying how many were left out. Pure.
 */
export function queryText(paths: string[], claims: LiveClaim[], decisions: Decision[], limit: number): string {
  const claimLines = claims
    .filter((c) => paths.some((p) => overlaps(c.path, p)))
    .sort((a, b) => b.since - a.since)
    .map((c) => `claim ${c.path} held by ${c.holderName}${c.task ? ` (${c.task})` : ""} since ${stamp(c.since)}`);
  const sorted = [...decisions].sort((a, b) => b.ts - a.ts);
  const exact = sorted.filter((d) => d.paths.some((p) => paths.some((q) => p === q || covers(q, p))));
  const parent = sorted.filter((d) => !exact.includes(d) && d.paths.some((p) => paths.some((q) => covers(p, q))));
  const decisionLines = [...exact, ...parent].map((d) => `decision ${d.id} ${stamp(d.ts)} ${d.author}: ${d.text} [${d.paths.join(" ")}]`);
  const items = [...claimLines, ...decisionLines];
  if (items.length === 0) return "No claims or decisions on these paths.";
  if (items.length <= limit) return items.join("\n");
  return [...items.slice(0, limit), `${items.length - limit} more; narrow the paths or pass a larger limit`].join("\n");
}

/** The rows an agent's summary covers: its own row and its subtree (rows nested deeper after it), or every row for main. */
export function scopeRows<T extends { id: string; depth: number }>(rows: T[], scope: string | null): T[] {
  if (scope === null) return rows;
  const at = rows.findIndex((r) => r.id === scope);
  if (at < 0) return [];
  const out = [rows[at]];
  for (let i = at + 1; i < rows.length && rows[i].depth > rows[at].depth; i++) out.push(rows[i]);
  return out;
}

/** The status line for the caller's own row, or a line saying it has none. Pure. */
export function statusText(row: RowLike | undefined, files: string[]): string {
  if (!row) return "No crew row for this agent yet.";
  const parts = [`${row.name}: ${row.state}`, row.task ? `task "${row.task}"` : "", `${row.calls} calls`, `last ${row.last || "none"}`,
    `${Math.round(row.elapsedMs / 1000)}s elapsed`, `files ${files.length ? files.join(", ") : "none"}`];
  return parts.filter(Boolean).join("; ");
}

/** Inputs for one summary: the scoped agents with their files, conflicts and decisions, and the time of the last summary. */
export type SummaryInput = {
  rows: RowLike[];
  files: Map<string, string[]>;
  scopeIds: Set<string> | null;
  conflicts: Conflict[];
  decisions: Decision[];
  decisionsOn: boolean;
  runs: RunLike[];
  since: number;
};

/**
 * One screen (at most 30 lines) for a director: the agents in scope with state and files, conflicts and decisions since
 * `since`, and unattributed changes on the most recent runs. Pure.
 */
export function summaryText(input: SummaryInput): string {
  const inScope = (id: string) => input.scopeIds === null || input.scopeIds.has(id);
  const agents = input.rows.filter((r) => inScope(r.id)).map((r) => {
    const files = input.files.get(r.id) ?? [];
    return `${r.name} (${r.state})${r.task ? ` ${r.task}` : ""}${files.length ? ` files: ${files.join(", ")}` : ""}`;
  });
  const conflicts = input.conflicts
    .filter((c) => c.ts > input.since && (input.scopeIds === null || input.scopeIds.has(c.writer_id) || input.scopeIds.has(c.holder_id)))
    .map((c) => `conflict ${c.path}: ${c.writer} wrote, ${c.holder} holds (${c.backed_off ? "backed off" : c.mode})`);
  const decisions = input.decisionsOn ? input.decisions.filter((d) => d.ts > input.since).map((d) => `decision ${d.id} ${d.author}: ${d.text}`) : null;
  const unattributed = input.runs.filter((r) => r.unattributed?.length).slice(0, RECENT_RUNS)
    .map((r) => `unattributed ${r.name}: ${(r.unattributed ?? []).join(", ")}`);
  const sections: [string, string[]][] = [
    ["Agents:", agents.length ? agents : ["none"]],
    ["Conflicts since your last summary:", conflicts.length ? conflicts : ["none"]],
  ];
  if (decisions) sections.push(["Decisions since your last summary:", decisions.length ? decisions : ["none"]]);
  sections.push(["Unattributed changes on recent runs:", unattributed.length ? unattributed : ["none"]]);
  const lines = sections.flatMap(([head, body]) => [head, ...body.map((b) => `  ${b}`)]);
  if (lines.length <= SUMMARY_LINES) return lines.join("\n");
  return [...lines.slice(0, SUMMARY_LINES - 1), `... ${lines.length - SUMMARY_LINES + 1} more lines not shown`].join("\n");
}
