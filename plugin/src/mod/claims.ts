/**
 * File claims between subagents. A claim comes from a spawn's `owns=` tag or from a subagent's first write to an
 * unclaimed path. A write to a path a live agent holds is a conflict unless one agent is the other's ancestor. Under
 * `deny` it is refused every time. Under `warn` the first write is refused with a note, and a retry of the same write
 * within the retry window goes through, with the director told. Claims are kept per repo root, in memory. Pure logic:
 * the clock and the store come in from the hook (plugin/hooks/register.ts).
 */
import type { Input } from "./api.ts";
import { appendConflicts } from "./board.ts";
import { commandDir, resolvePath } from "./guards.ts";
import { DYNAMIC_WRITE, outsideTree, REPO_WRITE, shellWrites } from "./shell-writes.ts";

/** `warn` refuses a conflicting write once, then lets its retry through with a note; `deny` refuses it; `off` makes no claims. */
export type ClaimMode = "warn" | "deny" | "off";
/** The `board` section of settings. */
export type BoardSettings = { claims: ClaimMode; claim_grace_min: number };
/**
 * An agent's identity for a write: its id, the name the roster shows, its task, and whether its type is read-only
 * (such an agent claims nothing and is never refused here).
 */
export type Writer = { id: string; name: string; task: string; readOnly?: boolean };
/** What a spawn reported: the agent, its parent, its repo root, the folder its relative `owns=` paths start from. */
export type Spawn = { id: string; name: string; task: string; parentId: string | null; root: string; base: string; owns: string };

/**
 * A path held by one agent. `path` is absolute and normalised; a directory claim ends in "/" and covers every path
 * under it. `endedAt` is set when the holder stops.
 */
export type Claim = { path: string; holderId: string; holderName: string; task: string; since: number; endedAt?: number };

/** One logged conflict. `backed_off` is true when the writer made no retry of the write, false when it did. */
export type Conflict = {
  ts: number; path: string; holder: string; writer: string; holder_id: string; writer_id: string; mode: "warn" | "deny"; backed_off?: boolean;
};

/**
 * What a write check decided: `deny` refuses the call, `notes` go to the main conversation, `logged` are the conflicts
 * a retry closed, for the store.
 */
export type Outcome = { deny?: string; notes: string[]; logged: Conflict[] };

/**
 * The in-memory state. `clock` returns epoch milliseconds, so tests can run with a fixed time. `open` holds conflicts
 * whose writer has not yet retried or stopped; `refusals` holds each warned refusal by (writer, path) and whether it was
 * retried.
 */
export type Book = {
  clock: () => number;
  claims: Map<string, Map<string, Claim>>;
  roots: Map<string, string>;
  parents: Map<string, string>;
  open: Conflict[];
  refusals: Map<string, { at: number; retried: boolean }>;
};

/** Store access the log needs: the mod store's get and set. */
export type Store = { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<void> };

const MINUTE_MS = 60_000;
const ANCESTOR_STEPS = 100;
/** How long after a warned refusal a retry of the same write still goes through. */
const RETRY_MS = 10 * MINUTE_MS;

/** A new, empty book; `clock` gives the time in epoch milliseconds. */
export function newBook(clock: () => number): Book {
  return { clock, claims: new Map(), roots: new Map(), parents: new Map(), open: [], refusals: new Map() };
}

/**
 * `path` made absolute against `base` and normalised: no ".", "..", doubled or trailing slashes, except that a
 * directory keeps its trailing "/". "" when neither the path nor the base is absolute.
 */
export function normalise(path: string, base: string): string {
  if (!path.startsWith("/") && !base.startsWith("/")) return "";
  const dir = path.endsWith("/");
  const full = path.startsWith("/") ? path : `${base.replace(/\/+$/, "")}/${path}`;
  const parts: string[] = [];
  for (const seg of full.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  if (parts.length === 0) return "/";
  return "/" + parts.join("/") + (dir ? "/" : "");
}

/** The claim covering `path`: one on the path itself or on a directory above it. */
function covering(held: Map<string, Claim>, path: string): Claim | undefined {
  const keys = [path];
  for (let i = path.indexOf("/"); i >= 0; i = path.indexOf("/", i + 1)) keys.push(path.slice(0, i + 1));
  for (const key of keys) {
    const claim = held.get(key);
    if (claim) return claim;
  }
  return undefined;
}

/** Whether `path` is claimed already, or a directory claim lies under it. */
function overlaps(held: Map<string, Claim>, path: string): boolean {
  if (covering(held, path)) return true;
  return path.endsWith("/") && [...held.keys()].some((key) => key.startsWith(path));
}

/** The repo root's claims, with expired ones dropped: a finished holder's claim lasts through the grace window. */
function sweep(book: Book, root: string, grace: number): Map<string, Claim> {
  let held = book.claims.get(root);
  if (!held) {
    held = new Map();
    book.claims.set(root, held);
  }
  const now = book.clock();
  for (const [key, claim] of held) {
    if (expired(claim, now, grace)) held.delete(key);
  }
  return held;
}

/** Whether `ancestor` is a parent, or a parent's parent, of `id`. */
function isAncestor(book: Book, ancestor: string, id: string): boolean {
  let parent = book.parents.get(id);
  for (let steps = 0; parent !== undefined && steps < ANCESTOR_STEPS; steps++) {
    if (parent === ancestor) return true;
    parent = book.parents.get(parent);
  }
  return false;
}

/** Whether one agent is the other's ancestor: their writes to one path are then not a conflict. */
function related(book: Book, a: string, b: string): boolean {
  return isAncestor(book, a, b) || isAncestor(book, b, a);
}

/** The grace window in milliseconds for the settings. */
function graceMs(settings: BoardSettings): number {
  return Math.max(0, Number(settings.claim_grace_min) || 0) * MINUTE_MS;
}

/**
 * Records a spawn's parent and repo root, and claims the paths its `owns=` tag lists. A declared path a live claim
 * already covers is left to its holder. Nothing is claimed when claims are off.
 */
export function claimSpawn(book: Book, settings: BoardSettings, spawn: Spawn): void {
  if (spawn.parentId) book.parents.set(spawn.id, spawn.parentId);
  book.roots.set(spawn.id, spawn.root);
  if (settings.claims === "off") return;
  const held = sweep(book, spawn.root, graceMs(settings));
  const now = book.clock();
  for (const raw of spawn.owns.split(",")) {
    const token = raw.trim();
    const path = token ? normalise(token, spawn.base) : "";
    if (!path || overlaps(held, path)) continue;
    held.set(path, { path, holderId: spawn.id, holderName: spawn.name, task: spawn.task, since: now });
  }
}

/** " (task)" for a claim whose holder has a task, else "". */
const taskPart = (claim: Claim): string => (claim.task ? ` (${claim.task})` : "");

/** The message a refused write shows: the path, who holds it, and what to do about it. */
function clashText(path: string, claim: Claim, mode: "warn" | "deny"): string {
  const held = `${path} is held by ${claim.holderName}${taskPart(claim)}`;
  if (mode === "deny") return `${held}; coordinate with the director or leave it`;
  return `${held}. If you must change it, retry the same write and it will go through; the director is told.`;
}

/**
 * A warned write that comes back within the retry window goes through. Its open conflict closes as not backed off, and
 * the first such retry gives the director its note. Returns false when there is no refusal to retry.
 */
function retried(book: Book, writerId: string, path: string, claim: Claim, now: number, out: Outcome): boolean {
  const seen = book.refusals.get(`${writerId}\n${path}`);
  if (!seen || now - seen.at > RETRY_MS) return false;
  if (!seen.retried) {
    seen.retried = true;
    book.open = book.open.filter((c) => {
      if (c.writer_id !== writerId || c.path !== path) return true;
      out.logged.push({ ...c, backed_off: false });
      return false;
    });
    out.notes.push(`${path} is held by ${claim.holderName}${taskPart(claim)}; the write went through on retry`);
  }
  return true;
}

/** Keeps one open conflict per writer and path, until the writer retries or stops. */
function openConflict(book: Book, writer: Writer, path: string, claim: Claim, mode: "warn" | "deny", now: number): void {
  if (book.open.some((c) => c.writer_id === writer.id && c.path === path)) return;
  book.open.push({ ts: now, path, holder: claim.holderName, holder_id: claim.holderId, writer: writer.name, writer_id: writer.id, mode });
}

/**
 * Checks one subagent's write to `paths` (absolute, or relative to `base`). A clash with a live agent another than the
 * writer's ancestor or child is refused: under `deny` every time, under `warn` the first time, and a retry within the
 * window goes through with a note. A write that runs claims the paths nobody covers. The main thread (no writer id)
 * never claims and never clashes.
 */
export function checkWrite(book: Book, settings: BoardSettings, writer: Writer, paths: string[], base: string): Outcome {
  const out: Outcome = { notes: [], logged: [] };
  if (settings.claims === "off" || !writer.id || writer.readOnly) return out;
  const mode = settings.claims === "deny" ? "deny" : "warn";
  const held = sweep(book, book.roots.get(writer.id) ?? "", graceMs(settings));
  const now = book.clock();
  const targets = [...new Set(paths.map((p) => normalise(p, base)).filter(Boolean))];
  const refuse: { path: string; claim: Claim }[] = [];
  for (const path of targets) {
    const claim = covering(held, path);
    if (!claim || claim.holderId === writer.id || related(book, writer.id, claim.holderId)) continue;
    if (mode === "warn" && retried(book, writer.id, path, claim, now, out)) continue;
    refuse.push({ path, claim });
  }
  const [first] = refuse;
  if (first) {
    for (const { path, claim } of refuse) {
      openConflict(book, writer, path, claim, mode, now);
      if (mode === "warn") book.refusals.set(`${writer.id}\n${path}`, { at: now, retried: false });
    }
    out.deny = clashText(first.path, first.claim, mode);
    return out;
  }
  for (const path of targets) {
    if (!covering(held, path)) held.set(path, { path, holderId: writer.id, holderName: writer.name, task: writer.task, since: now });
  }
  for (const claim of held.values()) if (claim.holderId === writer.id) delete claim.endedAt;
  return out;
}

/**
 * A subagent stopped: its claims start their grace window now, and its refusals end. Its conflicts still open never
 * retried, so they close as backed off. Returns those for the store.
 */
export function stopAgent(book: Book, id: string): Conflict[] {
  const now = book.clock();
  for (const held of book.claims.values()) {
    for (const claim of held.values()) if (claim.holderId === id && claim.endedAt === undefined) claim.endedAt = now;
  }
  for (const key of [...book.refusals.keys()]) if (key.startsWith(`${id}\n`)) book.refusals.delete(key);
  const closed: Conflict[] = [];
  book.open = book.open.filter((c) => {
    if (c.writer_id !== id) return true;
    closed.push({ ...c, backed_off: true });
    return false;
  });
  return closed;
}

/** The paths an edit tool call writes: file_path, or notebook_path for NotebookEdit. Other tools write none here. */
export function editPaths(e: Input): string[] {
  const tool = String(e.tool ?? "");
  if (!["Edit", "MultiEdit", "Write", "NotebookEdit"].includes(tool)) return [];
  const path = tool === "NotebookEdit" ? e.notebook_path : e.file_path;
  return typeof path === "string" && path ? [path] : [];
}

/**
 * The absolute paths a Bash command writes that can be claimed. A target is resolved through the leading `cd` only
 * (guards.ts commandDir, from an empty base), so a target still relative is dropped, as are scratch space and the
 * markers REPO_WRITE and DYNAMIC_WRITE, which name no file.
 * ponytail: the hook event carries no cwd, so `echo > a.ts` with no absolute `cd` claims nothing. Edit tools carry
 * absolute paths and cover most writes; the upgrade path is passing each subagent's working folder in from the hook.
 */
export function bashPaths(command: string): string[] {
  const dir = commandDir(command, "");
  const paths: string[] = [];
  for (const target of shellWrites(command) ?? []) {
    if (target === REPO_WRITE || target === DYNAMIC_WRITE) continue;
    const path = resolvePath(dir, target);
    if (path.startsWith("/") && !outsideTree(path)) paths.push(path);
  }
  return paths;
}

/** The file claims of this session's subagents, kept per repo root. The board tool reads its live claims from here. */
export const claimBook = newBook(Date.now);

/** Whether a finished holder's claim has outlived its grace window at `now`; a live holder's claim never has. */
export function expired(claim: Claim, now: number, grace: number): boolean {
  return claim.endedAt !== undefined && now - claim.endedAt > grace;
}

/** The claims on `root` still in force: live holders, and finished ones inside the grace window. */
export function liveClaims(book: Book, root: string, settings: BoardSettings): Claim[] {
  const now = book.clock();
  const grace = graceMs(settings);
  return [...(book.claims.get(root)?.values() ?? [])].filter((c) => !expired(c, now, grace));
}

/** Logs conflicts to the board's list in the store. */
export async function logConflicts(store: Store, conflicts: Conflict[]): Promise<void> {
  await appendConflicts(store, conflicts);
}
