/**
 * The late-failure flags file: `haikrew late-failures` (CLI, or the SessionStart hook) writes it, and the mod reads it
 * where $.process is not available (the desktop app). Also whether detection has any path at all, for the Insights card.
 */
import type { Run } from "./ledger.ts";

export type LateFile = Record<string, { late_fail: boolean; late_fail_commit?: string }>;

/** The flags, or {} for text that is not a JSON object. */
export function parseLateFile(text: string): LateFile {
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

/** `runs` with the file's flags applied by agent id, in the shape mergeLate takes as `flagged`. */
export function applyLateFile(runs: Run[], file: LateFile): Run[] {
  return runs.map((r) => (file[r.agent_id]?.late_fail === true ? { ...r, late_fail: true, late_fail_commit: file[r.agent_id].late_fail_commit } : r));
}

/** Set when neither $.process nor the flags file is available; the Insights card says so. */
let off = false;
export const setLateOff = (v: boolean): void => { off = v; };
export const lateOff = (): boolean => off;
export const LATE_OFF_TEXT = "Late-failure detection is off here: it needs the CLI or the session hook.";
