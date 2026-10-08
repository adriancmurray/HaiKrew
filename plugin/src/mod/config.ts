/**
 * HaiKrew settings for the mod, as pure functions over the stored settings object. The mod keeps settings only in
 * $.store under the key "settings"; the hooks module and the pane read and write it through the mods API.
 * Values come from schema.ts, so the mod and the CLI agree on defaults and limits.
 */
import { defaults, validate } from "../schema.ts";
import type { Settings, Value } from "../schema.ts";
import { isObject } from "./api.ts";

/** Settings from the stored object merged over defaults. Null and invalid values keep defaults. */
export function settingsFrom(stored: unknown): Settings {
  const out = defaults();
  if (!isObject(stored)) return out;
  for (const [section, values] of Object.entries(stored)) {
    if (!isObject(values)) continue;
    for (const [key, value] of Object.entries(values)) {
      if (validate(section, key, value) === null) out[section][key] = value as Value;
    }
  }
  return out;
}

/** Error messages for {section: {key: value}} changes the schema rejects. Empty when all are valid. */
export function checkChanges(changes: Record<string, Record<string, unknown>>): string[] {
  const errors: string[] = [];
  for (const [section, values] of Object.entries(changes)) {
    for (const [key, value] of Object.entries(values ?? {})) {
      const error = validate(section, key, value);
      if (error) errors.push(`${section}.${key}: ${error}`);
    }
  }
  return errors;
}

/** `current` with the changes applied over it. Call checkChanges first. */
export function mergeChanges(current: Settings, changes: Record<string, Record<string, unknown>>): Settings {
  for (const [section, values] of Object.entries(changes)) Object.assign(current[section], values);
  return current;
}
