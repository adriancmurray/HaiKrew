/** Crew names: a tag reads as a name, a pick is stable and skips taken names, and the list has no repeats. */
import { expect, test } from "claude-code/testing";
import { NAMES, nameFromTag, pickName } from "../../src/mod/names.ts";

test("a name tag reads as a name, and no tag gives an empty name", () => {
  expect(nameFromTag("HAIKREW job=x name=Katherine_JSON\nbody")).toBe("Katherine JSON");
  expect(nameFromTag("HAIKREW job=x lang=ts")).toBe("");
  expect(nameFromTag("not a header\nname=Katherine_JSON")).toBe("");
  expect(nameFromTag(undefined)).toBe("");
  expect(nameFromTag(`HAIKREW name=${"a".repeat(60)}`).length).toBe(40);
});

test("a pick is stable for one id, skips taken names, and gains II when all are taken", () => {
  const first = pickName("agent-1", new Set());
  expect(NAMES.includes(first)).toBe(true);
  expect(pickName("agent-1", new Set())).toBe(first);
  const next = pickName("agent-1", new Set([first]));
  expect(next === first).toBe(false);
  expect(NAMES.includes(next)).toBe(true);
  expect(pickName("agent-1", new Set(NAMES))).toBe(`${first} II`);
});

test("the names are 46 and none repeats", () => {
  expect(NAMES.length).toBe(46);
  expect(new Set(NAMES).size).toBe(NAMES.length);
});
