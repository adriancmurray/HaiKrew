/**
 * The Crew scene as data: pixel critters in the header's shapes and palette, laid out for one frame. The scene is
 * a pixel grid of PIXEL_ROWS rows; the terminal packs each pair of pixel rows into one cell (the upper half-block
 * glyph, top pixel as foreground, bottom as background), and desktop draws one SVG rect per pixel. Pure.
 */
import { modelFamily } from "./crew.ts";
import type { Crew } from "./crew.ts";

/** Pixel rows in the scene; the terminal shows half as many cell rows. */
export const PIXEL_ROWS = 18;
/** Terminal cell rows the scene occupies. */
export const SCENE_ROWS = PIXEL_ROWS / 2;
const MAX_CRITTERS = 12;
const SPACING = 8;
const BASE_Y = 11;
const LEAD_X = 2;
const UPPER_HALF_BLOCK = 0x2580;

/** Sprite rows: o body, s shade (bottom edge and legs), e eye. Eyes close to shade. */
const CRITTER = [
  ".ooooo.",
  "ooooooo",
  "ooeoeoo",
  "ooooooo",
  ".s.s.s.",
];
const ZZZ = ["###", "..#", "###"];

const NAVY = 0x0f1b33;
const STARS = [0x26385e, 0x5a6e96, 0xdfe6f5];
const CREAM = 0xffe9c7;
const EYE = 0x1b1420;
const LEAD_BODY = 0xd97757;
const MODEL_BODY: Record<string, number> = { haiku: 0xd97757, sonnet: 0x4f9c98, opus: 0x9b7fc7, unknown: 0x8a8f9c };

/** One critter on the scene: its top-left pixel, colours, and whether it is dimmed or has its eyes shut. */
export type Critter = { x: number; y: number; body: number; dim: boolean; asleep: boolean };

/** The laid-out scene: the pixel grid (row-major, PIXEL_ROWS by cols) and how many agents did not fit. */
export type Scene = { px: number[]; overflow: number };

/** Each colour channel of `a` moved toward `b` by fraction `t`. */
export function mix(a: number, b: number, t: number): number {
  let out = 0;
  for (const shift of [16, 8, 0]) {
    const x = (a >> shift) & 0xff;
    const y = (b >> shift) & 0xff;
    out = (out << 8) | Math.round(x + (y - x) * t);
  }
  return out;
}

/** The colour of a critter's shade: its body colour darkened. */
function shade(body: number): number {
  return mix(body, 0, 0.35);
}

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
    };
  });
  const lead: Critter = {
    x: LEAD_X, y: BASE_Y - (working && (frame >> 1) % 2 === 1 ? 1 : 0), body: LEAD_BODY,
    dim: false, asleep: crew.rows.length === 0,
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

/** The scene as an SVG document: a navy field with one crisp rect per lit pixel. */
export function sceneSvg(px: number[], cols: number): string {
  const rects = px.flatMap((c, i) => (c === NAVY ? [] : [
    `<rect x="${i % cols}" y="${Math.floor(i / cols)}" width="1" height="1" fill="${hex(c)}"/>`,
  ]));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${cols} ${PIXEL_ROWS}" shape-rendering="crispEdges">` +
    `<rect width="${cols}" height="${PIXEL_ROWS}" fill="${hex(NAVY)}"/>${rects.join("")}</svg>`;
}

function hex(c: number): string {
  return `#${c.toString(16).padStart(6, "0")}`;
}
