/** The desktop band's animated scene: colours by model, sizes, the lead's state and headwear, poses, and where the critters stand. */
import { expect, test } from "claude-code/testing";
import type { Crew, Lead, Row } from "../../src/mod/crew.ts";
import { animatedSceneSvg } from "../../src/mod/sprites.ts";
import type { SceneOpts } from "../../src/mod/sprites.ts";

const INK = { star: "#5a6e96", ground: "#26385e", bubble: "#ffffff", bubbleText: "#0f1b33" };
const NO_HEAD: SceneOpts = { headwear: "none" };

function row(id: string, model: string, state: Row["state"] = "working", over = false, last = ""): Row {
  return { id, depth: 0, name: "Ada Lovebytes", type: "agent", model, task: "", state, elapsedMs: 0, calls: 0, last, tokens: 0, cached: 0, over };
}

function crew(rows: Row[], lead?: Lead): Crew {
  return { rows, working: rows.filter((r) => r.state === "working").length, lead };
}

/** The contents of each critter's legs group, in document order. */
function legGroups(svg: string): string[] {
  return [...svg.matchAll(/class="legs">(.*?)<\/g>/g)].map((m) => m[1] ?? "");
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

test("each headwear kind draws its own class on the lead only, and none draws none", () => {
  const lead = crew([row("r", "haiku")], { state: "working", model: "opus" });
  for (const headwear of ["crown", "wizard", "cap"] as const) {
    const svg = animatedSceneSvg(lead, 60, INK, { headwear }).svg;
    expect(svg).toContain(`class="headwear-${headwear}"`);
    expect(svg.split('class="headwear-').length - 1).toBe(1);
  }
  expect(animatedSceneSvg(lead, 60, INK, NO_HEAD).svg).not.toContain('class="headwear-');
});

test("the tallest headwear on the largest lead still fits the band", () => {
  for (const headwear of ["crown", "wizard", "cap", "none"] as const) {
    const { spots } = animatedSceneSvg(crew([], { state: "directing", model: "opus" }), 60, INK, { headwear });
    expect((spots[0]?.top ?? -1) >= 0).toBe(true);
  }
});

test("each lead state shows its own marker", () => {
  const drawn = (state: Lead["state"]): string => animatedSceneSvg(crew([], { state, model: "opus" }), 60, INK).svg;
  expect(drawn("resting").split('class="z"').length - 1).toBe(3);
  const working = drawn("working");
  expect(working).toContain('class="bubble"');
  expect(working).toContain('class="act-editing"');
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

test("every critter's legs group holds exactly two pixels, in every lead state", () => {
  const rows = [
    row("a", "opus", "working", false, "Read a.ts"), row("b", "sonnet", "done"), row("c", "haiku", "failed", true),
    row("d", "unknown", "working", false, "Bash ls"), row("e", "haiku", "working", false, "Edit a.ts"),
    row("f", "haiku", "working", false, "WebSearch q"), row("g", "haiku", "working", false, "Agent x"),
  ];
  for (const state of ["working", "directing", "waiting", "resting"] as const) {
    const { svg, spots, overflow } = animatedSceneSvg(crew(rows, { state, model: "opus" }), 200, INK);
    expect(overflow).toBe(0);
    const groups = legGroups(svg);
    expect(groups.length).toBe(spots.length);
    for (const g of groups) expect(g.split("<rect").length - 1).toBe(2);
  }
});

test("each activity poses its critter under its own class", () => {
  const cases: Array<[string, Row["state"], string]> = [
    ["Read a.ts", "working", "reading"], ["Edit a.ts", "working", "editing"], ["Bash ls", "working", "running"],
    ["WebFetch http", "working", "web"], ["Agent x", "working", "directing"], ["", "working", "thinking"],
    ["Bash ls", "done", "done"], ["Bash ls", "failed", "failed"],
  ];
  for (const [last, state, activity] of cases) {
    const svg = animatedSceneSvg(crew([row("r", "haiku", state, false, last)]), 60, INK, NO_HEAD).svg;
    expect(svg).toContain(`class="act-${activity}"`);
  }
});

test("a thinking agent shows the bubble, and an over agent shows the amber warning instead of its prop", () => {
  const thinking = animatedSceneSvg(crew([row("r", "haiku", "working", false, "")]), 60, INK, NO_HEAD).svg;
  expect(thinking).toContain('class="act-thinking"');
  expect(thinking).toContain("#ffffff");
  const over = animatedSceneSvg(crew([row("r", "haiku", "working", true, "Bash ls")]), 60, INK, NO_HEAD).svg;
  expect(over).toContain("#c98a1b");
  expect(over).not.toContain('class="act-running"');
});

test("a colours override repaints its family, and a value that is not 6-digit hex is ignored", () => {
  const drawn = (colors: SceneOpts["colors"]): string =>
    animatedSceneSvg(crew([row("h", "haiku")]), 60, INK, { headwear: "none", colors }).svg;
  expect(drawn({ haiku: "#123456" })).toContain("#123456");
  expect(drawn({ haiku: "#123456" })).not.toContain("#9b7fc7");
  expect(drawn({ haiku: "purple" })).toContain("#9b7fc7");
});

test("a background is inserted after the opening svg tag and replaces the scene's own stars", () => {
  const sky = '<rect id="sky" width="60" height="22" fill="#102030"/>';
  const { svg } = animatedSceneSvg(crew([row("h", "haiku")]), 60, INK, { headwear: "none", background: sky });
  expect(svg).toContain(`shape-rendering="crispEdges">${sky}`);
  expect(svg).not.toContain('values=".15;.9;.15"');
  const plain = animatedSceneSvg(crew([row("h", "haiku")]), 60, INK, NO_HEAD).svg;
  expect(plain).toContain('values=".15;.9;.15"');
});

test("reserveRight keeps every spot clear of the reserved columns and counts what no longer fits as overflow", () => {
  const cols = 64;
  const rows = Array.from({ length: 6 }, (_, i) => row(`r${i}`, "sonnet"));
  const free = animatedSceneSvg(crew(rows), cols, INK, NO_HEAD);
  const kept = animatedSceneSvg(crew(rows), cols, INK, { headwear: "none", reserveRight: 20 });
  expect(kept.overflow > free.overflow).toBe(true);
  expect(kept.spots.length + kept.overflow).toBe(rows.length + 1);
  for (const s of kept.spots) expect(s.x + s.w <= cols - 1 - 20).toBe(true);
});
