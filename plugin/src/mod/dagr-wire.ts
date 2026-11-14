/**
 * The glue between the hooks and the dagr exporter: one module-level scheduler, the publish step, and a guard that
 * keeps every observation off the hook's reply path. It holds no `$`: a hook passes the few host calls it needs as
 * closures (DagrIo), so the rule that `$` stays in register.ts, pane.ts and agents.ts holds.
 */
import { dagrActive, dagrDocument, dagrGeneration, dagrReset } from "./dagr-run.ts";
import { makeScheduler, setDagrStatus } from "./dagr-schedule.ts";

/** The host calls a publish needs. `run` throws on a surface without a process runner. */
export type DagrIo = {
  after(ms: number, fn: () => void): unknown;
  run(argv: string[], opts: { cwd: string; timeoutMs: number }): Promise<{ exitCode: number; stdout?: string; stderr?: string }>;
  root: string;
};

/**
 * The largest candidate document passed on argv. Linux caps one argument at 128 KiB (MAX_ARG_STRLEN) and a larger one
 * makes the spawn throw, which would read as "no CLI" and switch the export off; a small crew's run is a few KiB.
 */
export const MAX_JSON = 120 * 1024;
export const NO_CLI = "Export requires the CLI surface";

let cwd = "";
let io: DagrIo | null = null;
let sched: ReturnType<typeof makeScheduler> | null = null;

/** The first line of the text, or "" when there is none. */
function firstLine(text: string | undefined): string {
  return (text ?? "").split("\n").find((l) => l.trim() !== "")?.trim() ?? "";
}

/** Publishes one candidate document. Resolves to null on success or a reason; a missing process runner disables export. */
export async function dagrPublish(json: string, host: DagrIo | null, dir: string, off: () => void): Promise<string | null> {
  if (json.length > MAX_JSON) return `run too large to publish (${Math.ceil(json.length / 1024)} KiB)`;
  if (!host) return NO_CLI;
  try {
    const r = await host.run(["node", `${host.root}/scripts/haikrew.mjs`, "dagr-publish", json], { cwd: dir, timeoutMs: 10000 });
    if (r.exitCode === 0) return null;
    return firstLine(r.stderr) || firstLine(r.stdout) || `publish exited ${r.exitCode}`;
  } catch {
    setDagrStatus(NO_CLI);
    off();
    return NO_CLI;
  }
}

/** The one scheduler, made on first use. */
function scheduler(): ReturnType<typeof makeScheduler> {
  if (!sched) {
    sched = makeScheduler({
      after: (ms, fn) => (io ? io.after(ms, fn) : undefined),
      publish: (json) => dagrPublish(json, io, cwd, () => sched?.disable()),
      document: () => dagrDocument(Date.now()),
      generation: dagrGeneration,
    });
  }
  return sched;
}

/**
 * Runs `observe` (a dagr-run call) when the export is on, then marks the run changed. Never throws and never waits:
 * a hook calls this without await and its own reply is unaffected.
 */
export function dagrWire(enabled: boolean, debounceMs: number, host: DagrIo, observe: (now: number) => void): void {
  if (!enabled) return;
  try {
    io = host;
    observe(Date.now());
    scheduler().changed(debounceMs);
  } catch {
    // The export never costs a hook its reply.
  }
}

/** A new session: clears the run, and remembers the folder the file is written under. */
export function dagrStart(enabled: boolean, debounceMs: number, host: DagrIo, session: { id: string; cwd: string }): void {
  dagrWire(enabled, debounceMs, host, (now) => {
    cwd = session.cwd;
    dagrReset(session, now);
  });
}

let sessionId = "";

/** Remembers the session's id at session start, export on or off, so a run switched on later still carries it. */
export function dagrSession(id: string): void {
  sessionId = id;
}

/**
 * Starts the run at an agent launch when the export was switched on after session start (no run yet). The spawn hook
 * has the settings and the session folder already, so this costs nothing while the export is off.
 */
export function dagrEnsure(enabled: boolean, debounceMs: number, host: DagrIo, cwd: string): void {
  if (!enabled || !cwd || dagrActive()) return;
  dagrStart(true, debounceMs, host, { id: sessionId, cwd });
}

/** The session id an event carries, or "". */
export function sessionIdOf(e: Record<string, unknown>): string {
  for (const k of ["sessionId", "session_id", "id"]) if (typeof e[k] === "string") return e[k] as string;
  return "";
}
