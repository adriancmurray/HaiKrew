import type { Event, Level, Rejected } from "./events.ts";

const LINE = /^(\d+) (\S+) ([^:\s]+):\s*(.*)$/;
const LEVELS: readonly Level[] = ["debug", "info", "warn", "error"];

/** Parses one `<ts> <LEVEL> <source>: <message>` line. `line` is its 1-based number. */
export function parseLine(text: string, line: number): Event | Rejected {
  const m = LINE.exec(text.trim());
  if (!m) return { line, reason: "syntax" };
  const level = m[2].toLowerCase() as Level;
  if (!LEVELS.includes(level)) return { line, reason: "level" };
  return { ts: Number(m[1]), level, source: m[3], message: m[4].trim() };
}
