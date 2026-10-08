/**
 * Seam check: agents that ran at the same time in one folder can each report green while their edits collide,
 * so a batch of two or more is flagged once, when its last agent stops. Module state for the session, fed by
 * the agent start and stop hooks.
 */

// Agent id -> the folder it runs in.
const cwdOf = new Map<string, string>();
// Folder -> the agents running in it now.
const active = new Map<string, Set<string>>();
// Folder -> every agent that joined the current batch there.
const batch = new Map<string, Set<string>>();

/** Forget every tracked agent and batch. Tests call this so each starts clean. */
export function resetSeams(): void {
  cwdOf.clear();
  active.clear();
  batch.clear();
}

/**
 * Record an agent starting in `cwd`. It joins the folder's open batch while another agent is still running
 * there; otherwise it starts a new batch.
 */
export function noteSeamStart(agentId: string, cwd: string): void {
  let running = active.get(cwd);
  if (!running || running.size === 0) {
    running = new Set();
    active.set(cwd, running);
    batch.set(cwd, new Set());
  }
  running.add(agentId);
  batch.get(cwd)?.add(agentId);
  cwdOf.set(agentId, cwd);
}

/**
 * Record an agent stopping. When it was the last one running in its folder and that batch had two or more
 * agents, returns the seam message once; otherwise null.
 */
export function noteSeamStop(agentId: string): string | null {
  const cwd = cwdOf.get(agentId);
  if (cwd === undefined) return null;
  cwdOf.delete(agentId);
  const running = active.get(cwd);
  running?.delete(agentId);
  if (running && running.size > 0) return null;
  active.delete(cwd);
  const joined = batch.get(cwd)?.size ?? 0;
  batch.delete(cwd);
  if (joined < 2) return null;
  return `HaiKrew seam check: ${joined} agents ran in parallel in ${cwd}. Run the repo's full verify before trusting their reports.`;
}
