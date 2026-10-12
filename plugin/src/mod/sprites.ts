/**
 * The Crew scene as data: pixel critters in the header's shapes and palette, laid out for one frame. The scene is
 * a pixel grid of PIXEL_ROWS rows; the terminal packs each pair of pixel rows into one cell (the upper half-block
 * glyph, top pixel as foreground, bottom as background), and desktop draws one SVG rect per pixel. Pure.
 */
import { modelFamily } from "./crew.ts";
import type { Crew, Lead, Row } from "./crew.ts";

/** Pixel rows in the scene; the terminal shows half as many cell rows. */
export const PIXEL_ROWS = 18;
/** Terminal cell rows the scene occupies. */
export const SCENE_ROWS = PIXEL_ROWS / 2;
/** Pixel rows of the desktop band's animated scene, taller than the terminal's so critters can scale up. */
export const SVG_ROWS = 22;
const MAX_CRITTERS = 12;
const SPACING = 8;
const BASE_Y = 11;
const LEAD_X = 2;
const UPPER_HALF_BLOCK = 0x2580;
const FEET = SVG_ROWS - 1;
const GAP = 2;
// Room after the lead for the indicator beside its head (baton, hourglass, bubble, z), clear of the next bubble.
const LEAD_GAP = 8;
const LEAD_SCALE = 1.35;
const GOLD = 0xe8b931;

type Family = ReturnType<typeof modelFamily>;
/** How big each model family's critter stands on the desktop band. */
const SCALE: Record<Family, number> = { haiku: 1, sonnet: 1.2, opus: 1.4, unknown: 1 };

/** Sprite rows: o body, s shade (bottom edge and legs), e eye. Eyes close to shade. */
const CRITTER = [
  ".ooooo.",
  "ooooooo",
  "ooeoeoo",
  "ooooooo",
  ".s.s.s.",
];
const ZZZ = ["###", "..#", "###"];
// The band's rising z: taller than the terminal's, so the diagonal reads at small sizes.
const ZED = ["###", "..#", ".#.", "#..", "###"];
const HOURGLASS = ["###", ".#.", ".#.", "###"];

const NAVY = 0x0f1b33;
const STARS = [0x26385e, 0x5a6e96, 0xdfe6f5];
const CREAM = 0xffe9c7;
const EYE = 0x1b1420;
const ORANGE = 0xd97757;
const MODEL_BODY: Record<Family, number> = { haiku: 0x9b7fc7, sonnet: 0x4f9c98, opus: ORANGE, unknown: 0x8a8f9c };

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
/** Options for the desktop band's scene: whether the lead wears its crown. */
export type SceneOpts = { crown: boolean };
/** Where one drawn critter stands on the desktop band, in scene pixels: its Row id, or "lead" for the lead. */
export type Spot = { id: string; x: number; w: number; top: number };

/**
 * The crew as one animated SVG on a transparent background, `SVG_ROWS` pixels tall, so the panel shows through. The
 * lead stands at the left, sized by its model and a further `LEAD_SCALE`; each agent follows, sized by its model.
 * Stars twinkle, the lead's state shows beside its head, working agents bob under a "…" bubble and finished ones stand
 * dimmed. All motion is SMIL inside the drawing; no script or timer.
 */
export function animatedSceneSvg(crew: Crew, cols: number, ink: SceneInk, opts: SceneOpts = { crown: true }): { svg: string; overflow: number; spots: Spot[] } {
  const lead: Lead = crew.lead ?? { state: crew.working > 0 ? "directing" : "resting", model: "opus" };
  const leadK = SCALE[modelFamily(lead.model)] * LEAD_SCALE;
  const spots: Spot[] = [{ id: "lead", x: LEAD_X, w: round2(7 * leadK), top: round2(FEET - (opts.crown ? 7 : 5) * leadK) }];
  const parts = [starRects(starPoints(cols, 8, 6), ink.star)];
  let right = LEAD_X + 7 * leadK;
  let drawn = 0;
  for (const row of crew.rows) {
    const k = SCALE[modelFamily(row.model)];
    const x = right + (drawn === 0 ? LEAD_GAP : GAP);
    if (x + 7 * k > cols - 1) break;
    parts.push(rowSvg(row, x, k, drawn, ink));
    spots.push({ id: row.id, x: round2(x), w: round2(7 * k), top: round2(FEET - 5 * k) });
    right = x + 7 * k;
    drawn++;
  }
  // Last, so the lead's indicator beside its head is not hidden under the next agent's bubble.
  parts.push(leadSvg(lead, opts.crown, ink));
  const ground = `<rect y="${FEET}" width="${cols}" height="1" fill="${ink.ground}"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${cols} ${SVG_ROWS}" shape-rendering="crispEdges">` +
    `${ground}${parts.join("")}</svg>`;
  return { svg, overflow: crew.rows.length - drawn, spots };
}

/** The lead: its critter at the left, and its state beside the head as a bubble, a baton, an hourglass or Zs. */
function leadSvg(lead: Lead, crown: boolean, ink: SceneInk): string {
  const family = modelFamily(lead.model);
  const k = SCALE[family] * LEAD_SCALE;
  const body = MODEL_BODY[family];
  const cx = LEAD_X + 3.5 * k;
  const ax = Math.round(LEAD_X + 7 * k) + 1;
  const ay = Math.round(FEET - 5 * k);
  const cap = crown ? crownSvg() : "";
  switch (lead.state) {
    case "working":
      return `<g>${figure(body, k, cx, "open", 3.5, cap)}<g class="bubble">${bubble(ax, ay, 0, ink)}</g>${bob("0.9s")}</g>`;
    case "directing":
      return `<g>${figure(body, k, cx, "open", 3.5, cap + baton())}${bob("1.4s")}</g>`;
    case "waiting":
      return `<g>${figure(body, k, cx, "glance", 3.5, cap)}${hourglass(ax, ay)}</g>`;
    case "resting":
      return `<g>${figure(body, k, cx, "shut", 3.5, cap)}${zs(ax, ay, ink)}</g>`;
  }
}

/** A crew member at `x`: its critter, bobbing under a "…" bubble while it works, dimmed once finished. */
function rowSvg(row: Row, x: number, k: number, slot: number, ink: SceneInk): string {
  const family = modelFamily(row.model);
  const body = row.state === "failed" ? mix(MODEL_BODY[family], MODEL_BODY.unknown, 0.6) : MODEL_BODY[family];
  const cx = x + 3.5 * k;
  const bx = Math.round(cx - 3);
  const by = Math.round(FEET - 5 * k) - 5;
  const working = row.state === "working";
  const indicator = row.over ? warning(bx, by, ink) : working ? bubble(bx, by, slot, ink) : "";
  const eyes = row.state === "done" ? "shut" : "open";
  return `<g${working ? "" : ` opacity=".55"`}>${figure(body, k, cx, eyes, 3.5 + (slot % 4) * 0.7, "")}${indicator}` +
    `${working ? bob("0.9s", slot * 0.17) : ""}</g>`;
}

/**
 * A critter in sprite coordinates, its feet on the ground line at `cx` and scaled by `k`. `eyes` is open (blinking
 * every `blink` seconds), shut, or glancing side to side; `extra` is drawn on the sprite too.
 */
function figure(body: number, k: number, cx: number, eyes: "open" | "shut" | "glance", blink: number, extra: string): string {
  const eye = eyes === "open" ? EYE : eyes === "shut" ? shade(body) : body;
  const lids = eyes === "open" ? `<g opacity="0">${spritePixels("e", shade(body))}<animate attributeName="opacity" ` +
    `values="0;0;1;0" keyTimes="0;0.92;0.96;1" dur="${blink.toFixed(1)}s" repeatCount="indefinite"/></g>` : "";
  const glance = eyes === "glance" ? `<g><animateTransform attributeName="transform" type="translate" values="-0.5 0;0.5 0" ` +
    `calcMode="discrete" dur="2s" repeatCount="indefinite"/>${spritePixels("e", EYE)}</g>` : "";
  return `<g transform="translate(${round2(cx)} ${FEET}) scale(${round2(k)}) translate(-3.5 -5)">` +
    `${spritePixels("o", body)}${spritePixels("s", shade(body))}${spritePixels("e", eye)}${lids}${glance}${extra}</g>`;
}

/** The sprite's pixels whose glyph is in `glyphs`, in colour `c`, as rects in sprite coordinates. */
function spritePixels(glyphs: string, c: number): string {
  return CRITTER.map((line, y) => [...line].map((ch, x) => (glyphs.includes(ch) ? rect(x, y, hex(c)) : "")).join("")).join("");
}

/** The gold crown over the lead's head, in sprite coordinates: three points, then a band. */
function crownSvg(): string {
  return `<g class="crown">${[1, 3, 5].map((x) => rect(x, -2, hex(GOLD))).join("")}` +
    `${[1, 2, 3, 4, 5].map((x) => rect(x, -1, hex(GOLD))).join("")}</g>`;
}

/** The directing lead's baton: two cream pixels at its right side, swinging between two spots. */
function baton(): string {
  return `<g class="baton"><rect x="7" y="1" width="1" height="2" fill="${hex(CREAM)}"/>` +
    `<animateTransform attributeName="transform" type="translate" values="0 0;0 1" calcMode="discrete" dur="0.6s" repeatCount="indefinite"/></g>`;
}

/** A small cream hourglass beside the head, pulsing: the lead waits for its crew. */
function hourglass(x: number, y: number): string {
  return `<g class="hourglass" transform="translate(${x} ${y})">${glyph(HOURGLASS, hex(CREAM))}` +
    `<animate attributeName="opacity" values=".35;1;.35" dur="1.6s" repeatCount="indefinite"/></g>`;
}

/** The resting lead's three Zs: each rises from beside its head, fading in and out, a second apart. */
function zs(x: number, y: number, ink: SceneInk): string {
  return [0.6, 0.8, 1].map((s, n) => `<g class="z" opacity="0"><g transform="translate(${x} ${y}) scale(${s})">${glyph(ZED, ink.star)}</g>` +
    `<animate attributeName="opacity" values="0;1;0" dur="3s" begin="${n}s" repeatCount="indefinite"/>` +
    `<animateTransform attributeName="transform" type="translate" values="0 0;3 -6" dur="3s" begin="${n}s" repeatCount="indefinite"/></g>`).join("");
}

/** A one-pixel discrete bob up and back on `dur`, starting `begin` seconds in. */
function bob(dur: string, begin = 0): string {
  return `<animateTransform attributeName="transform" type="translate" values="0 0;0 -1" calcMode="discrete" ` +
    `dur="${dur}" begin="${begin.toFixed(2)}s" repeatCount="indefinite"/>`;
}

/** A bitmap's lit pixels as rects from (0, 0), in `fill`. */
function glyph(rows: string[], fill: string): string {
  return rows.map((line, y) => [...line].map((ch, x) => (ch === "#" ? rect(x, y, fill) : "")).join("")).join("");
}

function rect(x: number, y: number, fill: string): string {
  return `<rect x="${x}" y="${y}" width="1" height="1" fill="${fill}"/>`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
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
  const face = ink.dark ? hex(CREAM) : hex(ORANGE);
  const shadow = hex(shade(ORANGE));
  const glyph = (dx: number, dy: number, color: string): string => [...title].map((ch, n) => (GLYPHS[ch] ?? []).map((row, gy) =>
    [...row].map((bit, gx) => (bit === "1" ? `<rect x="${tx + n * 6 + gx + dx}" y="${ty + gy + dy}" width="1" height="1" fill="${color}"/>` : "")).join("")).join("")).join("");
  const stars = starRects(starPoints(W, H, 7, { x: tx - 3, y: ty - 2, w: tw + 6, h: 11 }), ink.star);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" shape-rendering="crispEdges">` +
    `${stars}${ink.dark ? glyph(0, 1, shadow) : ""}${glyph(0, 0, face)}</svg>`;
}

function hex(c: number): string {
  return `#${c.toString(16).padStart(6, "0")}`;
}
