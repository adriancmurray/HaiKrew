/**
 * Display names for crew members: a famous name with a coding twist, so each agent on the roster reads as a person
 * rather than a type. Pure: the prompt and the taken names come in as values.
 */
import { tag } from "./select.ts";

/** The names an agent can be given. A pick starts from a hash of the agent's id into this list. */
export const NAMES: string[] = [
  "Ada Lovebytes", "Alan Tooling", "Grace Hotfix", "Marie Curl", "Nikola Testla", "Isaac Newline", "Albert Constein",
  "Leonardo da Vim", "Gitileo Galilei", "Charles Babbash", "Rosalind Fixlin", "Frida Kahlback", "Vincent van Go",
  "Claude Monade", "Pablo Pixasso", "Salvador Datalí", "Johannes Gitenberg", "Thomas Editson", "Alexander Graham Shell",
  "Katherine JSON", "Hedy Lambda", "Archimodes", "Nicolaus Copernicache", "Charles Diffwin", "Michelangelog", "Rembranch",
  "Ludwig van Buildhoven", "Wolfgang Amadebug", "Johann Sebastian Batch", "William Shakespec", "Pythonagoras",
  "Florence Nightbuild", "Emmy Nodether", "Carl Sagain", "Stephen Hashking", "Richard Feynmap", "Margaret Hamiltest",
  "Louis Pasteboard", "Georgia O'Cache", "Hokusync", "Orville Write", "James Watch", "Benjamin Franklint",
  "Hypatia Hypertext", "Lise Mightner", "Johannes Vimeer",
];

/**
 * The display name a prompt's `name=` tag asks for: underscores shown as spaces, trimmed, at most 40 characters.
 * "" when the prompt's first line has no tag.
 */
export function nameFromTag(prompt: unknown): string {
  return tag(prompt, "name").replace(/_/g, " ").slice(0, 40).trim();
}

/**
 * A crew name as both sides of a name comparison read it: underscores as spaces, spaces collapsed and trimmed, lowercase,
 * cut at " - " or " — " or a trailing period.
 */
export function normName(s: string): string {
  const head = s.replace(/_/g, " ").split(/ - | — /)[0] ?? "";
  return head.replace(/\s+/g, " ").trim().replace(/\.$/, "").trim().toLowerCase();
}

/**
 * A name for agent `id` that no taken name uses: the one its hash picks, or the next free one walking forward through
 * the list. When every name is taken, the hashed one with " II" after it.
 */
export function pickName(id: string, taken: Set<string>): string {
  const start = hashIndex(id);
  const ring = [...NAMES.slice(start), ...NAMES.slice(0, start)];
  return ring.find((name) => !taken.has(name)) ?? `${NAMES[start]} II`;
}

/** The list index an id hashes to: a 32-bit multiply-add, so the same id picks the same name in every session. */
function hashIndex(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) >>> 0;
  return h % NAMES.length;
}
