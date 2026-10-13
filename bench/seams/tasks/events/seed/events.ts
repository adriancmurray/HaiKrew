/** Severity of an event. */
export type Level = "info" | "warn" | "error";

/** One accepted event. */
export interface Event {
  ts: number;
  level: Level;
  source: string;
  message: string;
}

/** A line that was turned away: its 1-based line number and the reason. */
export interface Rejected {
  line: number;
  reason: string;
}
