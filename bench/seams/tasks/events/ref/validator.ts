import type { Event, Rejected } from "./events.ts";

const SOURCE = /^[a-z][a-z0-9-]*$/;
const MAX_MESSAGE = 200;

/** Accepts an event, cuts an overlong message by code point, or rejects it with the line number. */
export function validate(ev: Event, line: number): Event | Rejected {
  if (!Number.isInteger(ev.ts) || ev.ts < 1_000_000_000) return { line, reason: "ts" };
  if (!SOURCE.test(ev.source)) return { line, reason: "source" };
  if (ev.message.trim() === "") return { line, reason: "empty" };
  const codePoints = [...ev.message];
  if (codePoints.length > MAX_MESSAGE) {
    return { ...ev, message: codePoints.slice(0, MAX_MESSAGE).join(""), truncated: true };
  }
  return ev;
}
