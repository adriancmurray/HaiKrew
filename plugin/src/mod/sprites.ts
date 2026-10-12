/**
 * The Crew scene as data: pixel critters in the header's shapes and palette, laid out for one frame. The scene is
 * a pixel grid of PIXEL_ROWS rows; the terminal packs each pair of pixel rows into one cell (the upper half-block
 * glyph, top pixel as foreground, bottom as background). The desktop band's SVG scene lives in critters.ts and is
 * re-exported here. Pure.
 */
import { modelFamily } from "./crew.ts";
import type { Crew } from "./crew.ts";
import { CREAM, CRITTER, EYE, hex, LEAD_X, MODEL_BODY, mix, ORANGE, shade, starPoints, starRects } from "./critters.ts";
import type { SceneInk } from "./critters.ts";

export { activityOf, animatedSceneSvg, mix, SVG_ROWS, starPoints } from "./critters.ts";
export type { Activity, SceneInk, SceneOpts, Spot } from "./critters.ts";

/** Pixel rows in the scene; the terminal shows half as many cell rows. */
export const PIXEL_ROWS = 18;
/** Terminal cell rows the scene occupies. */
export const SCENE_ROWS = PIXEL_ROWS / 2;
const MAX_CRITTERS = 12;
const SPACING = 8;
const BASE_Y = 11;
const UPPER_HALF_BLOCK = 0x2580;

const NAVY = 0x0f1b33;
const STARS = [0x26385e, 0x5a6e96, 0xdfe6f5];
const ZZZ = ["###", "..#", "###"];

/** One critter on the scene: its top-left pixel, colours, and whether it is dimmed or has its eyes shut. */
export type Critter = { x: number; y: number; body: number; dim: boolean; asleep: boolean; alert?: boolean };

/** The laid-out scene: the pixel grid (row-major, PIXEL_ROWS by cols) and how many agents did not fit. */
export type Scene = { px: number[]; overflow: number };

/** Where every critter stands for this frame: the lead at the left, agents after it, nested ones a pixel lower. */
export function layout(crew: Crew, cols: number, frame: number): { critters: Critter[]; overflow: number } {
  const capacity = Math.max(1, Math.min(MAX_CRITTERS, Math.floor((cols - LEAD_X) / SPACING)));
  const drawn = crew.rows.slice(0, capacity - 1);
  const working = crew.working > 0;
  const critters: Critter[] = drawn.map((r, i) => {
    const slot = i + 1;
    const bob = working && r.state === "working" && ((frame >> 1) + slot) % 2 === 1 ? 1 : 0;
    return {
      x: LEAD_X + slot * SPACING,
      y: BASE_Y + (r.depth > 0 ? 1 : 0) - bob,
      body: MODEL_BODY[modelFamily(r.model)],
      dim: r.state !== "working",
      asleep: r.state === "working" && (frame + slot * 5) % 24 === 0,
      alert: r.over,
    };
  });
  const lead: Critter = {
    x: LEAD_X, y: BASE_Y - (working && (frame >> 1) % 2 === 1 ? 1 : 0),
    body: MODEL_BODY[modelFamily(crew.lead?.model ?? "opus")], dim: false, asleep: crew.rows.length === 0,
  };
  return { critters: [...critters.reverse(), lead], overflow: crew.rows.length - drawn.length };
}

/** The pixel grid for one frame: navy sky with twinkling stars, then the critters (lead last, so it stands in front). */
export function scene(crew: Crew, cols: number, frame: number): Scene {
  const px = new Array<number>(cols * PIXEL_ROWS).fill(NAVY);
  const put = (x: number, y: number, c: number): void => {
    if (x >= 0 && x < cols && y >= 0 && y < PIXEL_ROWS) px[y * cols + x] = c;
  };
  const stars = Math.max(3, Math.floor(cols / 9));
  for (let k = 0; k < stars; k++) {
    put((k * 37 + 11) % cols, (k * 23 + 3) % 9, STARS[(frame + k) % STARS.length]);
  }
  const { critters, overflow } = layout(crew, cols, frame);
  for (const c of critters) drawCritter(put, c);
  if (crew.rows.length === 0) {
    ZZZ.forEach((line, dy) => [...line].forEach((ch, dx) => ch === "#" && put(LEAD_X + 8 + dx, 5 + dy, CREAM)));
  }
  return { px, overflow };
}

function drawCritter(put: (x: number, y: number, c: number) => void, c: Critter): void {
  const shadeColour = shade(c.body);
  CRITTER.forEach((line, dy) => [...line].forEach((ch, dx) => {
    if (ch === ".") return;
    const colour = ch === "o" ? c.body : ch === "e" && !c.asleep ? EYE : shadeColour;
    put(c.x + dx, c.y + dy, c.dim ? mix(colour, NAVY, 0.5) : colour);
  }));
}

/** The scene as base64 of `cols * SCENE_ROWS` cells, each `[U+2580, top, bottom]` as little-endian u32 triplets. */
export function packCells(px: number[], cols: number): string {
  const buf = new ArrayBuffer(cols * SCENE_ROWS * 12);
  const words = new DataView(buf);
  for (let r = 0; r < SCENE_ROWS; r++) {
    for (let c = 0; c < cols; c++) {
      const at = (r * cols + c) * 12;
      words.setUint32(at, UPPER_HALF_BLOCK, true);
      words.setUint32(at + 4, px[2 * r * cols + c], true);
      words.setUint32(at + 8, px[(2 * r + 1) * cols + c], true);
    }
  }
  const bytes = new Uint8Array(buf);
  return btoa(String.fromCharCode(...bytes));
}

/** The title's 5x7 bitmap glyphs, as in the README banner. "1" is a lit pixel. */
const GLYPHS: Record<string, string[]> = {
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  a: ["00000", "00000", "01110", "00001", "01111", "10001", "01111"],
  i: ["00100", "00000", "01100", "00100", "00100", "00100", "01110"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  r: ["00000", "00000", "10110", "11001", "10000", "10000", "10000"],
  e: ["00000", "00000", "01110", "10001", "11111", "10000", "01110"],
  w: ["00000", "00000", "10001", "10001", "10101", "10101", "01010"],
};

/**
 * The top banner in the README header's style: the pixel "HaiKrew" title (cream with an orange drop shadow on a
 * dark panel, plain crew orange on a light one) among evenly spread twinkling stars. `width` is in CSS pixels;
 * the art is drawn on a grid of about four pixels a cell.
 */
export function bannerSvg(width: number, ink: SceneInk & { dark: boolean }): string {
  const W = Math.max(60, Math.round(width / 4));
  const H = 22;
  const title = "HaiKrew";
  const tw = title.length * 6 - 1;
  const tx = Math.floor((W - tw) / 2);
  const ty = 6;
  const face = ink.dark ? hex(CREAM) : hex(ORANGE);
  const shadow = hex(shade(ORANGE));
  const glyph = (dx: number, dy: number, color: string): string => [...title].map((ch, n) => (GLYPHS[ch] ?? []).map((row, gy) =>
    [...row].map((bit, gx) => (bit === "1" ? `<rect x="${tx + n * 6 + gx + dx}" y="${ty + gy + dy}" width="1" height="1" fill="${color}"/>` : "")).join("")).join("")).join("");
  const stars = starRects(starPoints(W, H, 7, { x: tx - 3, y: ty - 2, w: tw + 6, h: 11 }), ink.star);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" shape-rendering="crispEdges">` +
    `${stars}${ink.dark ? glyph(0, 1, shadow) : ""}${glyph(0, 0, face)}</svg>`;
}
