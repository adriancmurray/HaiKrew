import type { Event, Level, Rejected, Summary } from "./events.ts";
import { isRejected } from "./events.ts";
import { parseLine } from "./parser.ts";
import { validate } from "./validator.ts";

/** Summary of the accepted events plus every rejection, in input order. */
export interface Report {
  summary: Summary;
  rejected: Rejected[];
}

const LEVELS: Level[] = ["debug", "info", "warn", "error"];

/** Counts levels, sources and truncations over accepted events. */
export function summarize(events: Event[]): Summary {
  const byLevel = Object.fromEntries(LEVELS.map((l) => [l, 0])) as Record<Level, number>;
  const bySource: Record<string, number> = {};
  let truncated = 0;
  for (const e of events) {
    byLevel[e.level]++;
    const seen = Object.hasOwn(bySource, e.source) ? bySource[e.source] : 0;
    bySource[e.source] = seen + 1;
    if (e.truncated === true) truncated++;
  }
  return { total: events.length, byLevel, bySource, truncated };
}

/** Runs every line through parse and validate, then summarises the accepted events. */
export function runPipeline(lines: string[]): Report {
  const accepted: Event[] = [];
  const rejected: Rejected[] = [];
  lines.forEach((text, i) => {
    const line = i + 1;
    if (text.trim() === "") return;
    const parsed = parseLine(text, line);
    const result = isRejected(parsed) ? parsed : validate(parsed, line);
    if (isRejected(result)) rejected.push(result);
    else accepted.push(result);
  });
  return { summary: summarize(accepted), rejected };
}
