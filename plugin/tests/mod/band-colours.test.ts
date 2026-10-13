/** The pane's model colours: each family keeps its default unless the band's colour settings give one, and unknown models stay grey. */
import { expect, test } from "claude-code/testing";
import { modelColor } from "../../src/mod/ui.ts";

test("a model's colour is its family's default unless the band gives that family one", () => {
  expect(modelColor("claude-haiku-5-5")).toBe("#9b7fc7");
  expect(modelColor("claude-haiku-5-5", { haiku: "#123456" })).toBe("#123456");
  expect(modelColor("claude-opus-5-5", { haiku: "#123456" })).toBe("#d97757");
  expect(modelColor("mystery", { opus: "#123456" })).toBe("#8a8f9c");
});
