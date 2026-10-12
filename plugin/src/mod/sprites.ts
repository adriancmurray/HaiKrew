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
export type Critter = { x: number; y: number; body: number; dim: boolean; asleep: boolean; alert?: boolean };

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
      alert: r.over,
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

/** Star positions spread evenly: one per grid cell, nudged inside it, skipping cells a `keepOut` box covers. */
export function starPoints(width: number, height: number, cell: number, keepOut?: { x: number; y: number; w: number; h: number }): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  for (let cy = 0; cy * cell < height; cy++) {
    for (let cx = 0; cx * cell < width; cx++) {
      const h = Math.imul(cx + 1, 73856093) ^ Math.imul(cy + 1, 19349663);
      const r = (h >>> 0) / 4294967296;
      if (r > 0.6) continue;
      const x = Math.floor(cx * cell + cell * (0.15 + ((h >>> 8) & 255) / 255 * 0.7));
      const y = Math.floor(cy * cell + cell * (0.15 + ((h >>> 16) & 255) / 255 * 0.7));
      if (x >= width || y >= height) continue;
      if (keepOut && x >= keepOut.x - 1 && x <= keepOut.x + keepOut.w && y >= keepOut.y - 1 && y <= keepOut.y + keepOut.h) continue;
      out.push([x, y, r]);
    }
  }
  return out;
}

/** Twinkling stars as SVG rects in `color`, each on its own slow cycle. */
function starRects(points: Array<[number, number, number]>, color: string): string {
  return points.map(([x, y, r], k) => `<rect x="${x}" y="${y}" width="1" height="1" fill="${color}" opacity=".3">` +
    `<animate attributeName="opacity" values=".15;.9;.15" dur="${(2.6 + r * 3).toFixed(1)}s" begin="${((k * 0.53) % 3).toFixed(2)}s" repeatCount="indefinite"/></rect>`).join("");
}

/** The scene's colours on one background: the ground line and stars from the ink, the bubble behind "…". */
export type SceneInk = { star: string; ground: string; bubble: string; bubbleText: string };

/**
 * The crew as one animated SVG on a transparent background, so the panel shows through: evenly spread stars
 * twinkle, working critters bob with a "…" bubble over them, awake critters blink, finished agents stand dimmed,
 * and with no agents the lead sleeps under a drifting Z. All motion is SMIL inside the drawing; no timer needed.
 */
export function animatedSceneSvg(crew: Crew, cols: number, ink: SceneInk): { svg: string; overflow: number } {
  const { critters, overflow } = layout(crew, cols, 0);
  const pixel = (x: number, y: number, c: number): string => `<rect x="${x}" y="${y}" width="1" height="1" fill="${hex(c)}"/>`;
  const parts: string[] = [starRects(starPoints(cols, 8, 6), ink.star)];
  critters.forEach((c, i) => {
    const lead = i === critters.length - 1;
    const working = lead ? crew.working > 0 : !c.dim;
    const body: string[] = [];
    drawCritter((x, y, colour) => body.push(pixel(x, y, colour)), { ...c, dim: false, asleep: lead && c.asleep });
    const lids: string[] = [];
    if (!(lead && c.asleep)) {
      CRITTER.forEach((line, dy) => [...line].forEach((ch, dx) => {
        if (ch === "e") lids.push(pixel(c.x + dx, c.y + dy, shade(c.body)));
      }));
    }
    const blink = lids.length ? `<g opacity="0">${lids.join("")}<animate attributeName="opacity" values="0;0;1;0" ` +
      `keyTimes="0;0.92;0.96;1" dur="${(3.5 + (i % 4) * 0.7).toFixed(1)}s" repeatCount="indefinite"/></g>` : "";
    const bob = working ? `<animateTransform attributeName="transform" type="translate" values="0 0;0 -1" calcMode="discrete" ` +
      `dur="0.9s" begin="${(i * 0.17).toFixed(2)}s" repeatCount="indefinite"/>` : "";
    const typing = c.alert ? warning(c.x + 3, c.y - 5, ink) : working && !lead ? bubble(c.x + 3, c.y - 5, i, ink) : "";
    parts.push(`<g${c.dim ? ` opacity=".45"` : ""}>${body.join("")}${blink}${typing}${bob}</g>`);
  });
  if (crew.rows.length === 0) {
    const z: string[] = [];
    ZZZ.forEach((line, dy) => [...line].forEach((ch, dx) => {
      if (ch === "#") z.push(`<rect x="${LEAD_X + 8 + dx}" y="${5 + dy}" width="1" height="1" fill="${ink.star}"/>`);
    }));
    parts.push(`<g>${z.join("")}<animate attributeName="opacity" values="0;1;1;0" dur="3s" repeatCount="indefinite"/>` +
      `<animateTransform attributeName="transform" type="translate" values="0 2;0 0;0 -2" dur="3s" repeatCount="indefinite"/></g>`);
  }
  const ground = `<rect y="${PIXEL_ROWS - 1}" width="${cols}" height="1" fill="${ink.ground}"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${cols} ${PIXEL_ROWS}" shape-rendering="crispEdges">` +
    `${ground}${parts.join("")}</svg>`;
  return { svg, overflow };
}

/** A small speech bubble with three dots that light in turn: the agent is working. */
function bubble(x: number, y: number, i: number, ink: SceneInk): string {
  const dots = [0, 1, 2].map((d) => `<rect x="${x + 1 + d * 2}" y="${y + 1}" width="1" height="1" fill="${ink.bubbleText}" opacity=".25">` +
    `<animate attributeName="opacity" values=".25;1;.25" dur="1.2s" begin="${(d * 0.2 + i * 0.13).toFixed(2)}s" repeatCount="indefinite"/></rect>`).join("");
  return `<rect x="${x - 0.25}" y="${y - 0.25}" width="7.5" height="3.5" fill="${ink.ground}"/><rect x="${x + 0.75}" y="${y + 3}" width="1.5" height="1.25" fill="${ink.ground}"/>` +
    `<rect x="${x}" y="${y}" width="7" height="3" fill="${ink.bubble}"/><rect x="${x + 1}" y="${y + 3}" width="1" height="1" fill="${ink.bubble}"/>${dots}`;
}

/** A bubble with a "!" in amber, pulsing: the agent is past the token warning. */
function warning(x: number, y: number, ink: SceneInk): string {
  const amber = "#c98a1b";
  return `<g><rect x="${x - 0.25}" y="${y - 0.25}" width="4.5" height="3.5" fill="${amber}"/>` +
    `<rect x="${x}" y="${y}" width="4" height="3" fill="${ink.bubble}"/><rect x="${x + 1.75}" y="${y + 0.5}" width="0.5" height="1.25" fill="${amber}"/>` +
    `<rect x="${x + 1.75}" y="${y + 2}" width="0.5" height="0.5" fill="${amber}"/>` +
    `<animate attributeName="opacity" values="1;.35;1" dur="1.4s" repeatCount="indefinite"/></g>`;
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
  const face = ink.dark ? hex(CREAM) : hex(LEAD_BODY);
  const shadow = hex(shade(LEAD_BODY));
  const glyph = (dx: number, dy: number, color: string): string => [...title].map((ch, n) => (GLYPHS[ch] ?? []).map((row, gy) =>
    [...row].map((bit, gx) => (bit === "1" ? `<rect x="${tx + n * 6 + gx + dx}" y="${ty + gy + dy}" width="1" height="1" fill="${color}"/>` : "")).join("")).join("")).join("");
  const stars = starRects(starPoints(W, H, 7, { x: tx - 3, y: ty - 2, w: tw + 6, h: 11 }), ink.star);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" shape-rendering="crispEdges">` +
    `${stars}${ink.dark ? glyph(0, 1, shadow) : ""}${glyph(0, 0, face)}</svg>`;
}

function hex(c: number): string {
  return `#${c.toString(16).padStart(6, "0")}`;
}
