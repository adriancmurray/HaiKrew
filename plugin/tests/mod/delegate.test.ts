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
  expect(note).toContain("`HAIKREW job=implement lang=ts name=Katherine_JSON`");
  expect(note).toContain("Vincent van Go, Marie Curl, Ludwig van Buildhoven");
  expect(note).toContain("run on Haiku");
  expect(note).toContain("Opus subagents are refused");
  expect(note).toContain("`job:review=sonnet`");
  expect(delegationNote({ ...GATE, allow_opus: true, allow_nested: false, rules: [] })).toContain("Opus subagents are allowed; routing rules (first match wins): none; agents may not start their own.");
});

test("the note tells the main model how to follow a review note, once", () => {
  const lines = delegationNote(GATE).split("\n");
  const bullets = lines.filter((l) => l.includes("review note"));
  expect(bullets.length).toBe(1);
  expect(bullets[0].startsWith("- When HaiKrew posts a review note after an agent finishes")).toBe(true);
  expect(bullets[0]).toContain("light → launch the `haikrew:haiku-checker` agent with `HAIKREW job=check name=...`");
  expect(bullets[0]).toContain("`HAIKREW job=review name=...`");
  expect(bullets[0]).toContain("call `review_packet` first");
  expect(bullets[0]).toContain("`VERDICT: PASS|FAIL for <name>`");
  expect(bullets[0]).toContain("Only a note that says inline");
  expect(bullets[0]).not.toContain("a deep note may instead");
});

test("the note keeps the main thread thin: exploring and checking go to agents, not to the main model", () => {
  const bullets = delegationNote(GATE).split("\n").filter((l) => l.includes("Keep this thread thin"));
  expect(bullets.length).toBe(1);
  expect(bullets[0]).toContain("every tool call here re-reads the whole conversation");
  expect(bullets[0]).toContain("`Explore` (model haiku)");
  expect(bullets[0]).toContain("`haikrew:haiku-checker` (`HAIKREW job=check`)");
  expect(bullets[0]).toContain("When you must act yourself, batch: chain the steps in one Bash call (&&, ;) and make independent calls in one message.");
  expect(delegationNote(GATE)).toContain("then verify it with `haikrew:haiku-checker`");
});

test("with the tools on given explicitly, the note is the same as by default", () => {
  expect(delegationNote(GATE, true)).toBe(delegationNote(GATE));
});

test("with the tools off, the note names neither review tool and still tells the main model to follow the note", () => {
  const note = delegationNote(GATE, false);
  expect(note).not.toContain("record_verdict");
  expect(note).not.toContain("review_packet");
  expect(note).not.toContain("mcp__haikrew__");
  const bullets = note.split("\n").filter((l) => l.includes("review note"));
  expect(bullets.length).toBe(1);
  expect(bullets[0]).toContain("light → launch the `haikrew:haiku-checker` agent with `HAIKREW job=check name=...` and the packet from the note");
  expect(bullets[0]).toContain("`HAIKREW job=review name=...`");
  expect(bullets[0]).toContain("the packet from the note in its prompt");
  expect(bullets[0]).toContain("`VERDICT: PASS|FAIL for <name>`");
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
