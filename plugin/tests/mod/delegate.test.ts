/** The delegation note: off with the gate or the switch, built from the gate settings, appended once. */
import { expect, test } from "claude-code/testing";
import { delegationNote, withNote } from "../../src/mod/delegate.ts";
import type { DelegateSettings } from "../../src/mod/delegate.ts";

const GATE: DelegateSettings = {
  enabled: true, delegate: true, default_model: "haiku", allow_opus: false, pinned_types: ["haiku-coder"],
  allow_nested: true, nested_model: "haiku", rules: ["job:review=sonnet"], rules_override: false, default_effort: [], instructions: [],
};

test("no note while the gate or the switch is off", () => {
  expect(delegationNote({ ...GATE, enabled: false })).toBe("");
  expect(delegationNote({ ...GATE, delegate: false })).toBe("");
});

test("the note reflects the gate settings", () => {
  const note = delegationNote(GATE);
  expect(note).toContain("standing request");
  expect(note).toContain("run on Haiku");
  expect(note).toContain("Opus subagents are refused");
  expect(note).toContain("`job:review=sonnet`");
  expect(delegationNote({ ...GATE, allow_opus: true, allow_nested: false, rules: [] })).toContain("Opus subagents are allowed; routing rules (first match wins): none; agents may not start their own.");
});

test("withNote appends to the CLAUDE.md block once, adds one when missing, and leaves other blocks alone", () => {
  const blocks = [{ name: "other", text: "x" }, { name: "claudeMd", text: "Mine." }];
  const once = withNote(blocks, "N") as { name: string; text: string }[];
  expect(once[1].text).toBe("Mine.\n\nN");
  expect(once[0]).toEqual({ name: "other", text: "x" });
  expect(withNote(once, "N")).toBe(once);
  expect(withNote([{ name: "other", text: "x" }], "N")).toEqual([{ name: "other", text: "x" }, { name: "claudeMd", text: "N" }]);
  expect(withNote(blocks, "")).toBe(blocks);
});
