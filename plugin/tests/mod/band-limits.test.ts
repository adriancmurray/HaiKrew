/** The band's scene at its limits: every scenery, sky, season, width and crew size stays under the host's SVG source limit once anchored, finite, repeatable, with its bots apart and in the room. */
import { expect, test } from "claude-code/testing";
import type { Crew, Lead, Row } from "../../src/mod/crew.ts";
import { bandScene } from "../../src/mod/band/scene.ts";
import type { BandScene } from "../../src/mod/band/scene.ts";
import { anchorAnimations } from "../../src/mod/svg.ts";
import { defaults } from "../../src/schema.ts";
import type { Settings } from "../../src/schema.ts";

/** The host's limit on an SVG source, in characters. */
const LIMIT = 131072;
const NOW = new Date(2026, 9, 12, 12, 0).getTime();
const KINDS = ["mountains", "city", "forest", "hills"];
const SKIES = ["dawn", "day", "dusk", "night"];
const SEASONS = ["winter", "spring", "summer", "autumn", "none"];
const WIDTHS = [600, 1000, 1500, 2400];
const COUNTS = [0, 8, 16, 60];
const MODELS = ["haiku", "sonnet", "opus"];
const LAST = ["Read a.ts", "Edit a.ts", "Bash ls", "WebSearch x", "Agent x", ""];

/** One combination of the matrix: its label for failure output, its width, its crew size and its band settings. */
interface Combo { label: string; width: number; count: number; band: Settings["band"] }
/** One combination's drawing: its scene, and its SVG source as the pane hands it to the host, anchored. */
interface Drawn { combo: Combo; scene: BandScene; anchored: string }

/** A main agent on an opus id that is searching the web, and `count` working subagents of mixed models and activities. */
function crew(count: number): Crew {
  const rows: Row[] = Array.from({ length: count }, (_, i) => ({
    id: `r${i}`, depth: 0, name: `r${i}`, type: "agent", model: MODELS[i % MODELS.length] ?? "haiku", task: "",
    state: "working", elapsedMs: 0, calls: 0, last: LAST[i % LAST.length] ?? "", tokens: 0, cached: 0, over: false,
  }));
  const lead: Lead = { state: "working", model: "claude-opus-5-5", activity: "web" };
  return { rows, working: rows.length, lead };
}

/** Every scenery kind × sky × season × width × crew size, with clouds on (the largest case) and the other settings at their defaults. */
function combos(): Combo[] {
  const out: Combo[] = [];
  for (const scenery of KINDS) for (const sky of SKIES) for (const season of SEASONS) for (const width of WIDTHS) for (const count of COUNTS) {
    out.push({ label: `${scenery} ${sky} ${season} ${width} px ${count} agents`, width, count,
      band: { ...defaults().band, scenery, sky, season, clouds: true } as Settings["band"] });
  }
  return out;
}

function draw(c: Combo): BandScene {
  return bandScene(crew(c.count), { width: c.width, band: c.band, now: NOW });
}

const DRAWN: Drawn[] = combos().map((combo) => {
  const scene = draw(combo);
  return { combo, scene, anchored: anchorAnimations(scene.svg, NOW) };
});

/** The matrix's largest drawing once anchored. */
const LARGEST = DRAWN.reduce((best, d) => (d.anchored.length > best.anchored.length ? d : best));

/** True when the spots run in order without overlap, and each ends at or before width minus 70 (the orb room). */
function spotsFit(d: Drawn): boolean {
  const { spots } = d.scene;
  for (let i = 1; i < spots.length; i++) {
    const prev = spots[i - 1], next = spots[i];
    if (!prev || !next || next.x < prev.x + prev.w) return false;
  }
  return spots.every((s) => s.x + s.w <= d.combo.width - 70);
}

test("every scenery, sky, season, width and crew size draws under the host's limit once anchored", () => {
  const over = DRAWN.filter((d) => d.anchored.length >= LIMIT).map((d) => d.combo.label);
  expect(over).toEqual([]);
});

test(`the largest drawing, ${LARGEST.combo.label}, anchors to ${LARGEST.anchored.length} characters (limit ${LIMIT})`, () => {
  expect(LARGEST.anchored.length).toBeLessThan(LIMIT);
});

test("a crew past the budget drops its rest as overflow, and the drawing still fits once anchored", () => {
  const big = DRAWN.filter((d) => d.combo.count === 60 && d.combo.width === 1500 && d.combo.band.scenery === "city");
  expect(big.length > 0 && big.every((d) => d.scene.overflow > 0 && d.anchored.length < LIMIT)).toBe(true);
});

test("every drawing is finite markup: no NaN or undefined, once anchored", () => {
  const bad = DRAWN.filter((d) => d.anchored.includes("NaN") || d.anchored.includes("undefined")).map((d) => d.combo.label);
  expect(bad).toEqual([]);
});

test("equal inputs give the identical string, every combination", () => {
  const unstable = combos().filter((c, i) => draw(c).svg !== DRAWN[i]?.scene.svg).map((c) => c.label);
  expect(unstable).toEqual([]);
});

test("the spots never overlap and all lie left of width minus 70", () => {
  const misplaced = DRAWN.filter((d) => !spotsFit(d)).map((d) => d.combo.label);
  expect(misplaced).toEqual([]);
});

test("every subagent is either drawn or counted as overflow", () => {
  const miscounted = DRAWN.filter((d) => d.scene.spots.length - 1 + d.scene.overflow !== d.combo.count).map((d) => d.combo.label);
  expect(miscounted).toEqual([]);
});
