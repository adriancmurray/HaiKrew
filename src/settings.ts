/**
 * HaiKrew settings: one schema, defaults derived from it, a JSON file the panel edits.
 *
 * The schema is the single source of truth. The panel renders its Settings view from SCHEMA,
 * hooks read values with get(), and save() refuses values the schema rejects.
 * File: $HAIKREW_HOME/settings.json (default ~/.config/haikrew). Node >= 22.18, no dependencies.
 */
import { defaults, validate } from "./schema.ts";
import type { Settings, Value } from "./schema.ts";
export { SCHEMA, defaults, validate } from "./schema.ts";
export type { Field, Section, Settings, Value } from "./schema.ts";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const HOME = process.env.HAIKREW_HOME ?? join(homedir(), ".config", "haikrew");
export const DATA = process.env.HAIKREW_DATA ?? join(homedir(), ".local", "share", "haikrew");
export const SETTINGS_FILE = join(HOME, "settings.json");

/** Settings from disk merged over defaults. Unknown or invalid stored values fall back to defaults. */
export function load(): Settings {
  const out = defaults();
  let stored: unknown;
  try { stored = JSON.parse(readFileSync(SETTINGS_FILE, "utf8")); } catch { return out; }
  if (!stored || typeof stored !== "object") return out;
  for (const [s, values] of Object.entries(stored as Record<string, unknown>)) {
    if (!values || typeof values !== "object") continue;
    for (const [k, v] of Object.entries(values as Record<string, unknown>)) {
      if (validate(s, k, v) === null) out[s][k] = v as Value;
    }
  }
  return out;
}

/** One setting value. */
export function get<T extends Value>(section: string, key: string): T {
  return load()[section][key] as T;
}

/** Apply {section: {key: value}} over current settings. Returns errors; writes only when there are none. */
export function save(changes: Record<string, Record<string, unknown>>): string[] {
  const errors: string[] = [];
  for (const [s, kv] of Object.entries(changes)) {
    for (const [k, v] of Object.entries(kv ?? {})) {
      const e = validate(s, k, v);
      if (e) errors.push(`${s}.${k}: ${e}`);
    }
  }
  if (errors.length) return errors;
  const cur = load();
  for (const [s, kv] of Object.entries(changes)) Object.assign(cur[s], kv);
  mkdirSync(HOME, { recursive: true });
  const tmp = SETTINGS_FILE + ".tmp";
  writeFileSync(tmp, JSON.stringify(cur, null, 2) + "\n");
  renameSync(tmp, SETTINGS_FILE);
  return [];
}
