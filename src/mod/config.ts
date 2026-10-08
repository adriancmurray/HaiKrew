/**
 * HaiKrew settings for the mod, as pure functions over the settings.json text. The hooks module reads and
 * writes the file through the mods API (hooks/register.ts), since `$` may not be passed across imports.
 * Values come from schema.ts, so the mod and the CLI agree on defaults and limits.
 */
import { defaults, validate } from "../schema.ts";
import type { Settings, Value } from "../schema.ts";
import { isObject } from "./api.ts";

/** settings.json under $HAIKREW_HOME, else ~/.config/haikrew under HOME. */
export function settingsFile(haikrewHome: string | undefined, home: string | undefined): string {
  const dir = haikrewHome || `${home ?? ""}/.config/haikrew`;
  return `${dir}/settings.json`;
}

/** Settings from settings.json text merged over defaults. Null, unparseable text, and invalid values keep defaults. */
export function parseSettings(text: string | null): Settings {
  const out = defaults();
  let stored: unknown;
  try {
    stored = JSON.parse(text ?? "");
  } catch {
    return out;
  }
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
