/**
 * Decider health: while decider.mode is not "off", GET <url>/health (short timeout) at session start or the first
 * agent launch, then at most every 10 minutes. A failure raises one toast and a status line on the settings card;
 * recovery clears the line. State is module memory; the fetch and the clock come in as arguments.
 */
export const HEALTH_EVERY_MS = 10 * 60 * 1000;
export const HEALTH_TIMEOUT_MS = 1500;
export const START_HINT = "launchctl kickstart -k gui/$(id -u)/com.clefkit.workers-ai";

type State = { checkedAt: number; ok: boolean; url: string };
let state: State | null = null;

/** The warning for the settings card, or "" when the decider is fine or not checked yet. */
export function healthLine(): string {
  return state && !state.ok ? `Offline at ${state.url}: decisions are skipped. Start it: ${START_HINT}` : "";
}

/** Forget the last check (tests; a mode change to "off"). */
export function resetHealth(): void {
  state = null;
  inflight = null;
}

let inflight: Promise<string> | null = null;

/**
 * Check the endpoint unless a check ran in the last 10 minutes for this url or one is running now (parallel callers
 * share it, so only one can toast). Returns the toast text when the decider just went offline, else "". `get` resolves
 * true for a 2xx answer and rejects or resolves false otherwise.
 */
export function checkHealth(url: string, now: number, get: (url: string, timeoutMs: number) => Promise<boolean>): Promise<string> {
  const base = url.replace(/\/+$/, "");
  if (inflight || (state && state.url === base && now - state.checkedAt < HEALTH_EVERY_MS)) return Promise.resolve("");
  const was = state && state.url === base ? state.ok : true;
  state = { checkedAt: now, ok: was, url: base }; // claimed before the await
  inflight = get(`${base}/health`, HEALTH_TIMEOUT_MS).catch(() => false).then((ok) => {
    state = { checkedAt: now, ok, url: base };
    return !ok && was ? `Clef decider offline at ${base}: decisions are skipped. Start it: ${START_HINT}` : "";
  }).finally(() => { inflight = null; });
  return inflight;
}
