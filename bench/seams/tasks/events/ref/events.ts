/** Severity of an event, lowest first. */
export type Level = "debug" | "info" | "warn" | "error";

/** One accepted event. `truncated` is set when the message was cut. */
export interface Event {
  ts: number;
  level: Level;
  source: string;
  message: string;
  truncated?: boolean;
}

/** A line that was turned away: its 1-based line number and the reason. */
export interface Rejected {
  line: number;
  reason: string;
}

/** Counts over a list of accepted events. */
export interface Summary {
  total: number;
  byLevel: Record<Level, number>;
  bySource: Record<string, number>;
  truncated: number;
}

/** True when a parser or validator result is a rejection rather than an event. */
export function isRejected(x: Event | Rejected): x is Rejected {
  return "reason" in x;
}
