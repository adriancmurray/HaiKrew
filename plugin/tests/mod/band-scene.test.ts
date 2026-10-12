/** The desktop band's animated scene: colours by model, sizes, the lead's state and crown, and where the critters stand. */
import { expect, test } from "claude-code/testing";
import type { Crew, Lead, Row } from "../../src/mod/crew.ts";
import { animatedSceneSvg } from "../../src/mod/sprites.ts";

const INK = { star: "#5a6e96", ground: "#26385e", bubble: "#ffffff", bubbleText: "#0f1b33" };

function row(id: string, model: string, state: Row["state"] = "working", over = false): Row {
  return { id, depth: 0, name: "agent", model, task: "", state, elapsedMs: 0, calls: 0, last: "", tokens: 0, over };
}

function crew(rows: Row[], lead?: Lead): Crew {
  return { rows, working: rows.filter((r) => r.state === "working").length, lead };
}

test("a haiku row draws in purple and an opus lead in orange", () => {
  expect(animatedSceneSvg(crew([row("h", "haiku")]), 60, INK).svg).toContain("#9b7fc7");
  expect(animatedSceneSvg(crew([], { state: "resting", model: "opus" }), 60, INK).svg).toContain("#d97757");
});

test("crew members grow from haiku to sonnet to opus, and an opus lead is wider than an opus member", () => {
  const width = (model: string): number => animatedSceneSvg(crew([row("r", model)]), 60, INK).spots[1]?.w ?? 0;
  expect(width("haiku") < width("sonnet")).toBe(true);
  expect(width("sonnet") < width("opus")).toBe(true);
  const { spots } = animatedSceneSvg(crew([row("r", "opus")], { state: "working", model: "opus" }), 60, INK);
  expect((spots[0]?.w ?? 0) > (spots[1]?.w ?? 0)).toBe(true);
});

test("the crown is drawn on the lead only when asked for", () => {
  const lead = crew([row("r", "haiku")], { state: "working", model: "opus" });
  const on = animatedSceneSvg(lead, 60, INK, { crown: true }).svg;
  expect(on).toContain("#e8b931");
  expect(on).toContain('class="crown"');
  const off = animatedSceneSvg(lead, 60, INK, { crown: false }).svg;
  expect(off).not.toContain("#e8b931");
  expect(off).not.toContain('class="crown"');
});

test("each lead state shows its own marker", () => {
  const drawn = (state: Lead["state"]): string => animatedSceneSvg(crew([], { state, model: "opus" }), 60, INK).svg;
  expect(drawn("resting").split('class="z"').length - 1).toBe(3);
  const working = drawn("working");
  expect(working).toContain('class="bubble"');
  expect(working).not.toContain('class="z"');
  expect(drawn("directing")).toContain('class="baton"');
  expect(drawn("waiting")).toContain('class="hourglass"');
});

test("every spot lies inside the scene, and the viewBox is the band's height", () => {
  const cols = 64;
  const rows = [row("a", "opus"), row("b", "sonnet", "done"), row("c", "haiku", "failed", true), row("d", "unknown")];
  const { svg, spots, overflow } = animatedSceneSvg(crew(rows, { state: "directing", model: "sonnet" }), cols, INK);
  expect(svg).toContain(`viewBox="0 0 ${cols} 22"`);
  expect(overflow).toBe(0);
  expect(spots.map((s) => s.id)).toEqual(["lead", "a", "b", "c", "d"]);
  for (const s of spots) {
    expect(s.x >= 0).toBe(true);
    expect(s.x + s.w <= cols).toBe(true);
    expect(s.top >= 0).toBe(true);
  }
});

test("rows that do not fit in 48 columns are left out and counted as overflow", () => {
  const rows = Array.from({ length: 12 }, (_, i) => row(`r${i}`, "haiku"));
  const { overflow, spots } = animatedSceneSvg(crew(rows, { state: "directing", model: "opus" }), 48, INK);
  expect(overflow > 0).toBe(true);
  expect(spots.length + overflow).toBe(rows.length + 1);
});
