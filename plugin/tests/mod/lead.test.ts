/** The main agent's state in the band: from its own turn and how many crew members work. */
import { expect, test } from "claude-code/testing";
import { leadActivity, leadState, noteMainChunk, noteMainStep, noteTurnEnd, resetCrew } from "../../src/mod/crew.ts";

test("the main agent works, directs, waits and rests", () => {
  resetCrew();
  expect(leadState(0)).toBe("resting");
  expect(leadState(2)).toBe("waiting");
  expect(noteMainStep("t1")).toBe(true);
  expect(noteMainStep("t1")).toBe(false);
  expect(leadState(0)).toBe("working");
  expect(leadState(3)).toBe("directing");
  noteTurnEnd("other");
  expect(leadState(0)).toBe("working");
  noteTurnEnd("t1");
  expect(leadState(0)).toBe("resting");
});

test("the main agent's activity follows its streamed chunks, and a main turn's end resets it", () => {
  resetCrew();
  noteMainStep("t1");
  expect(leadActivity()).toBe("other");
  expect(noteMainChunk({ kind: "thinking", index: 0, text: "Hmm." })).toBe(true);
  expect(noteMainChunk({ kind: "thinking", index: 0, text: "Still." })).toBe(false);
  expect(leadActivity()).toBe("thinking");
  expect(noteMainChunk({ kind: "text", index: 1, text: "Hi" })).toBe(true);
  expect(leadActivity()).toBe("writing");
  expect(noteMainChunk({ kind: "tool", index: 2, id: "u1", name: "Bash" })).toBe(true);
  expect(leadActivity()).toBe("running");
  noteTurnEnd("other");
  expect(leadActivity()).toBe("running");
  noteTurnEnd("t1");
  expect(leadActivity()).toBe("other");
});

test("a tool call's name sorts it into an activity; other tools, MCP ones included, are other", () => {
  resetCrew();
  const tool = (name: string): boolean => noteMainChunk({ kind: "tool", index: 0, id: "u", name });
  expect(tool("Read")).toBe(true);
  expect(leadActivity()).toBe("reading");
  expect(tool("Edit")).toBe(true);
  expect(leadActivity()).toBe("editing");
  expect(tool("WebSearch")).toBe(true);
  expect(leadActivity()).toBe("web");
  expect(tool("Agent")).toBe(true);
  expect(leadActivity()).toBe("directing");
  expect(tool("mcp__x__y")).toBe(true);
  expect(leadActivity()).toBe("other");
  tool("Bash");
  expect(tool("constructor")).toBe(true);
  expect(leadActivity()).toBe("other");
});

test("chunks that show no activity leave it as it was", () => {
  resetCrew();
  noteMainChunk({ kind: "text", index: 0, text: "x" });
  expect(noteMainChunk({ kind: "input", index: 1, text: "{}" })).toBe(false);
  expect(noteMainChunk({ kind: "engine", ref: 3 })).toBe(false);
  expect(noteMainChunk(undefined)).toBe(false);
  expect(leadActivity()).toBe("writing");
});
