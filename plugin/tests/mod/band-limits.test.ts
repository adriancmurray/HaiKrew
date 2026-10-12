/** The band's scene at its limits: every scenery, sky, season and width stays under the Svg source limit, finite, repeatable, with its bots apart and in the room. */
import { expect, test } from "claude-code/testing";
import type { Crew, Lead, Row } from "../../src/mod/crew.ts";
import { bandScene } from "../../src/mod/band/scene.ts";
import type { BandScene } from "../../src/mod/band/scene.ts";
import { defaults } from "../../src/schema.ts";
import type { Settings } from "../../src/schema.ts";

const LIMIT = 110000;
const NOW = new Date(2026, 9, 12, 12, 0).getTime();
const KINDS = ["mountains", "city", "forest", "hills"];
const SKIES = ["dawn", "day", "dusk", "night"];
const SEASONS = ["winter", "autumn"];
const WIDTHS = [600, 1080, 1800, 2400];
const MODELS = ["haiku", "sonnet", "opus"];
const LAST = ["Read a.ts", "Edit a.ts", "Bash ls", "WebSearch x", "Agent x", ""];

/** One combination of the matrix: its label for failure output, its width in scene pixels, and its band settings. */
interface Combo { label: string; width: number; band: Settings["band"] }

/** Ten working subagents of mixed models and activities, and a main agent on an opus id that is searching the web. */
function crew(): Crew {
  const rows: Row[] = Array.from({ length: 10 }, (_, i) => ({
    id: `r${i}`, depth: 0, name: `r${i}`, type: "agent", model: MODELS[i % MODELS.length] ?? "haiku", task: "",
    state: "working", elapsedMs: 0, calls: 0, last: LAST[i % LAST.length] ?? "", tokens: 0, cached: 0, over: false,
  }));
  const lead: Lead = { state: "working", model: "claude-opus-5-5", activity: "web" };
  return { rows, working: rows.length, lead };
}

const CREW = crew();

/** Every scenery kind × sky × season × width, with the band's other settings at their defaults. */
function combos(): Combo[] {
  const out: Combo[] = [];
  for (const scenery of KINDS) for (const sky of SKIES) for (const season of SEASONS) for (const width of WIDTHS) {
    out.push({ label: `${scenery} ${sky} ${season} ${width}`, width, band: { ...defaults().band, scenery, sky, season } as Settings["band"] });
  }
  return out;
}

function draw(c: Combo): BandScene {
  return bandScene(CREW, { width: c.width, band: c.band, now: NOW });
}

/** True when the spots are in order without overlap, and each ends at or before width minus 70 (the orb room). */
function spotsFit(c: Combo): boolean {
  const { spots } = draw(c);
  for (let i = 1; i < spots.length; i++) {
    const prev = spots[i - 1], next = spots[i];
    if (!prev || !next || next.x < prev.x + prev.w) return false;
  }
  return spots.every((s) => s.x + s.w <= c.width - 70);
}

/** The combination whose drawing is largest, and that drawing's length in characters. */
function largest(): { label: string; chars: number } {
  let best = { label: "", chars: 0 };
  for (const c of combos()) {
    const chars = draw(c).svg.length;
    if (chars > best.chars) best = { label: c.label, chars };
  }
  return best;
}

const LARGEST = largest();

test("every scenery, sky, season and width draws under the 110000-character limit", () => {
  const over = combos().filter((c) => draw(c).svg.length >= LIMIT).map((c) => c.label);
  expect(over).toEqual([]);
});

test(`the largest combination, ${LARGEST.label}, draws ${LARGEST.chars} characters (limit ${LIMIT})`, () => {
  expect(LARGEST.chars).toBeLessThan(LIMIT);
});

test("every drawing is finite markup: no NaN or undefined", () => {
  const bad = combos().filter((c) => {
    const { svg } = draw(c);
    return svg.includes("NaN") || svg.includes("undefined");
  }).map((c) => c.label);
  expect(bad).toEqual([]);
});

test("equal inputs give the identical string, every combination", () => {
  const unstable = combos().filter((c) => draw(c).svg !== draw(c).svg).map((c) => c.label);
  expect(unstable).toEqual([]);
});

test("the spots never overlap and all lie left of width minus 70", () => {
  const misplaced = combos().filter((c) => !spotsFit(c)).map((c) => c.label);
  expect(misplaced).toEqual([]);
});
