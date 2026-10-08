/**
 * Effort for subagents: remembers the effort the gate chose for each agent this session, and gives it to that
 * agent's later steps when the step already carries an effort field (the model supports effort). The main loop
 * has no agent id and is never changed.
 */
import type { Input } from "./api.ts";

const tracked = new Map<string, string>();

/** Remembers the effort chosen for a subagent, so its later steps can carry it. */
export function noteEffort(agentId: string, effort: string): void {
  tracked.set(agentId, effort);
}

/** Forgets every tracked agent, for a fresh session. */
export function resetEffort(): void {
  tracked.clear();
}

/** The step with the tracked effort set when it belongs to a tracked subagent that already has an effort field; else the step unchanged. */
export function stepEffort(e: Input): Input {
  const id = e.agentId;
  if (typeof id !== "string" || e.effort === undefined) return e;
  const effort = tracked.get(id);
  return effort === undefined ? e : { ...e, effort };
}
