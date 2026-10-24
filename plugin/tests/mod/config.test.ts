/** Stored settings from an older version: a retired section is ignored, and the other sections load as their defaults. */
import { expect, test } from "claude-code/testing";
import { settingsFrom } from "../../src/mod/config.ts";
import { defaults } from "../../src/schema.ts";

test("a retired section from an older version loads without error and is dropped", () => {
  const settings = settingsFrom({ retired: { enabled: true } });
  expect(Object.hasOwn(settings, "retired")).toBe(false);
  expect(settings).toEqual(defaults());
});
