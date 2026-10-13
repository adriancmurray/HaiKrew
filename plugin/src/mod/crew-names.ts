/**
 * Display names reserved for the session. A name is kept after its agent leaves the roster, because review packets
 * and verdicts are keyed by it; a second agent that asks for a taken name gets "II", "III"...
 */
import { NAMES } from "./names.ts";

// Lowercase name -> the id of the agent that holds it.
const reserved = new Map<string, string>();

const ROMAN = ["II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

/** `base` for agent `id`, or `base II`, `base III`... when another agent had it this session. The name is reserved. */
export function claimName(id: string, base: string): string {
  let name = base;
  for (let n = 0; reserved.has(name.toLowerCase()) && reserved.get(name.toLowerCase()) !== id; n++) name = `${base} ${ROMAN[n] ?? n + 2}`;
  reserved.set(name.toLowerCase(), id);
  return name;
}

/** Give back `name` if `id` holds it (a picked name replaced by the spawn's own tag). */
export function releaseName(id: string, name: string): void {
  if (reserved.get(name.toLowerCase()) === id) reserved.delete(name.toLowerCase());
}

/** The picker names already reserved, for pickName's taken set. */
export function takenNames(): Set<string> {
  return new Set(NAMES.filter((n) => reserved.has(n.toLowerCase())));
}

/** Forget every reservation (tests, and resetCrew). */
export function resetNames(): void {
  reserved.clear();
}
