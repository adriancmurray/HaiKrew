/**
 * Update check: at most every 6 hours, read the plugin version from the repo's plugin.json on GitHub and keep it, so the
 * pane can say when a newer HaiKrew exists. The fetch, the stored record and the clock come in as arguments; `runUpdate`
 * takes the command runner the same way. State is module memory (the in-flight check only).
 */
export const UPDATE_URL = "https://raw.githubusercontent.com/adriancmurray/HaiKrew/main/plugin/.claude-plugin/plugin.json";
export const UPDATE_EVERY_MS = 6 * 3600 * 1000;
export const UPDATE_TIMEOUT_MS = 5000;
export const UPDATE_COMMAND = ["claude", "plugin", "update", "haikrew@haikrew"];

/** The last check: the newest version seen and the time it was read. */
export type UpdateRecord = { latest: string; checkedAt: number };

/** Host access for `checkUpdate`: the clock, the stored record, the save, and a GET that resolves to the body. */
export type UpdateIo = {
  now: number;
  load(): Promise<unknown>;
  save(r: UpdateRecord): Promise<void>;
  get(url: string, timeoutMs: number): Promise<string>;
};

/** What a finished command reported. */
export type RunResult = { exitCode: number; stdout: string; stderr: string };

const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-dev\.(\d+))?$/;

function parse(version: string): { core: number[]; dev: number | null } | null {
  const m = VERSION.exec(version.trim());
  if (!m) return null;
  return { core: [Number(m[1]), Number(m[2]), Number(m[3])], dev: m[4] === undefined ? null : Number(m[4]) };
}

/** Whether `latest` is a later release than `installed`. A version that does not parse is never newer. */
export function newer(installed: string, latest: string): boolean {
  const a = parse(installed);
  const b = parse(latest);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a.core[i] !== b.core[i]) return b.core[i] > a.core[i];
  if (a.dev === null) return false; // same release, or a release against a dev build of it
  return b.dev === null || b.dev > a.dev; // a dev build precedes its release; two dev builds compare counters
}

/** The `version` field of a plugin.json text, or "" when the text is not JSON or has none. */
export function versionOf(text: string): string {
  try {
    const version = (JSON.parse(text) as { version?: unknown }).version;
    return typeof version === "string" ? version : "";
  } catch {
    return "";
  }
}

/** The stored record if the value has the right shape, else null. */
export function recordOf(value: unknown): UpdateRecord | null {
  if (!value || typeof value !== "object") return null;
  const r = value as Record<string, unknown>;
  return typeof r.latest === "string" && typeof r.checkedAt === "number" && Number.isFinite(r.checkedAt)
    ? { latest: r.latest, checkedAt: r.checkedAt }
    : null;
}

let inflight: Promise<UpdateRecord | null> | null = null;

/** Forget the in-flight check (tests). */
export function resetUpdate(): void {
  inflight = null;
}

/**
 * The stored record while it is under 6 hours old, else a fresh read of plugin.json, saved with the time. Parallel callers
 * share one request. Never throws. A failed read keeps the previous latest version and is still saved, so it is not
 * retried until the next 6 hours. A failed load returns null without a request.
 */
export function checkUpdate(io: UpdateIo): Promise<UpdateRecord | null> {
  if (!inflight) inflight = refresh(io).finally(() => { inflight = null; });
  return inflight;
}

async function refresh(io: UpdateIo): Promise<UpdateRecord | null> {
  let stored: UpdateRecord | null;
  try {
    stored = recordOf(await io.load());
  } catch {
    return null;
  }
  if (stored && io.now - stored.checkedAt >= 0 && io.now - stored.checkedAt < UPDATE_EVERY_MS) return stored;
  let version = "";
  try {
    version = versionOf(await io.get(UPDATE_URL, UPDATE_TIMEOUT_MS));
  } catch {
    // Keeps the previous latest below.
  }
  const record = { latest: version || stored?.latest || "", checkedAt: io.now };
  try {
    await io.save(record);
  } catch {
    // A lost save only means the next check reads again.
  }
  return record;
}

/** The newer version to offer for `installed`, or "" when there is none (or no record). */
export function availableUpdate(installed: string, record: UpdateRecord | null): string {
  return record && newer(installed, record.latest) ? record.latest : "";
}

const firstLine = (text: string): string => text.split("\n").map((line) => line.trim()).find(Boolean) ?? "";

/** The line to show after `claude plugin update` finished: success, the first line of its error, or a fallback. */
export function updateOutcome(result: RunResult | Error, latest: string): string {
  if (result instanceof Error) return firstLine(result.message) || "claude plugin update failed";
  if (result.exitCode === 0) return `Updated. Restart Claude to use ${latest}.`;
  return firstLine(result.stderr) || firstLine(result.stdout) || `claude plugin update failed (exit ${result.exitCode})`;
}

/** Run the plugin update through `run` and return the line to show; a throw is reported like a failed run. */
export async function runUpdate(run: (argv: string[]) => Promise<RunResult>, latest: string): Promise<string> {
  try {
    return updateOutcome(await run(UPDATE_COMMAND), latest);
  } catch (e) {
    return updateOutcome(e instanceof Error ? e : new Error(String(e)), latest);
  }
}
