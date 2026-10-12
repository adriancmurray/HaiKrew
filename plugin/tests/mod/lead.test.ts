/** The main agent's state in the band: from its own turn and how many crew members work. */
import { expect, test } from "claude-code/testing";
import { leadState, noteMainStep, noteTurnEnd, resetCrew } from "../../src/mod/crew.ts";

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
