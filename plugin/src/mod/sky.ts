/**
 * The desktop band's pixel sky: a gradient by hour, twinkling stars, drifting clouds and a sun or moon at the far
 * right, as SVG elements in scene pixels. Pure: the caller supplies the clock and wraps the body in an <svg>.
 */
import { starPoints } from "./sprites.ts";

export type SkyMode = "live" | "dawn" | "day" | "dusk" | "night" | "off";
/** A sun or moon: centre and radius in scene pixels. */
export type Orb = { kind: "sun" | "moon"; x: number; y: number; r: number };

type Palette = [string, string, string];
type Quad<T> = [T, T, T, T];

const SYNODIC_DAYS = 29.530588853;
const NEW_MOON_MS = Date.UTC(2000, 0, 6, 18, 14);
const DAY_MS = 86_400_000;
const ORB_GAP = 6;
const ORB_R = 3;
const GLOW_R = ORB_R + 2;
const SUN_HIGH = 4;
const MOON_Y = 5;
const STAR = "#dfe6f5";
const SUN = "#ffe08a";
const SUN_RIM = "#ffd166";
const CREAM = "#f3ead2";
const MOON_EDGE = "#5a6e96";
// The unlit part of the moon, faintly visible (earthshine), so even a new moon reads as a moon to hover.
const MOON_DARK = "#2e3b5c";
const CLOUD_DAY = "#f5f4ef";
const CLOUD_NIGHT = "#8b93a8";

/** Dawn, day, dusk, night, in the order the sky runs through them. Night runs past midnight. */
const PERIODS = [
  { start: 5, end: 8 },
  { start: 8, end: 17 },
  { start: 17, end: 21 },
  { start: 21, end: 29 },
];
const PALETTES: Quad<Palette> = [
  ["#3a3a7a", "#e88a8a", "#f2b36b"],
  vertical("#5b8fd1", "#a9cbef"),
  vertical("#4b3a73", "#e8875a"),
  vertical("#0f1b33", "#1c2b4d"),
];
const STAR_ALPHA: Quad<number> = [0.4, 0, 0.4, 1];
const DAYLIGHT: Quad<number> = [0.5, 1, 0.5, 0];
// Each overlaps its neighbours so the outline reads as one cloud.
const CLOUD_SHAPES: Array<Array<[number, number, number, number]>> = [
  [[0, 2, 8, 2], [1, 1, 5, 2], [5, 0, 2, 2]],
  [[0, 1, 6, 2], [2, 0, 3, 2]],
  [[0, 2, 10, 2], [2, 1, 4, 2], [7, 1, 3, 2]],
];

/** `hour` folded into [0, 24). */
function wrapHour(hour: number): number {
  return ((hour % 24) + 24) % 24;
}

/** The signed distance in hours from `delta` to the nearest multiple of 24, in [-12, 12). */
function wrapDelta(delta: number): number {
  return ((delta + 36) % 24) - 12;
}

/** Colour `a` moved toward `b` by fraction `t`, one hex channel at a time. */
function lerpHex(a: string, b: string, t: number): string {
  const x = parseInt(a.slice(1), 16);
  const y = parseInt(b.slice(1), 16);
  let out = 0;
  for (const shift of [16, 8, 0]) {
    const from = (x >> shift) & 255;
    const to = (y >> shift) & 255;
    out = (out << 8) | Math.round(from + (to - from) * t);
  }
  return `#${out.toString(16).padStart(6, "0")}`;
}

function lerpNum(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function mixPalette(a: Palette, b: Palette, t: number): Palette {
  return [lerpHex(a[0], b[0], t), lerpHex(a[1], b[1], t), lerpHex(a[2], b[2], t)];
}

/** A top-to-horizon gradient with its middle stop halfway between the two. */
function vertical(top: string, horizon: string): Palette {
  return [top, lerpHex(top, horizon, 0.5), horizon];
}

/**
 * The value for the period `hour` falls in. Within an hour either side of a period edge the value lerps from one
 * period to the next, so the sky has no step at 5, 8, 17 or 21 o'clock.
 */
function blend<T>(hour: number, values: Quad<T>, mix: (a: T, b: T, t: number) => T): T {
  const h = wrapHour(hour);
  for (let i = 0; i < PERIODS.length; i++) {
    const d = wrapDelta(h - PERIODS[i].end);
    if (Math.abs(d) < 1) return mix(values[i], values[(i + 1) % PERIODS.length], (d + 1) / 2);
  }
  const i = PERIODS.findIndex((p) => wrapHour(h - p.start) < p.end - p.start);
  return values[i];
}

/** The hour the sky shows: the fixed hour of a fixed mode, the live hour for live and off. */
export function skyHour(mode: SkyMode, liveHour: number): number {
  switch (mode) {
    case "dawn": return 6.5;
    case "day": return 12;
    case "dusk": return 19;
    case "night": return 23;
    case "live":
    case "off": return liveHour;
  }
}

/** Moon phase at `ms` as a fraction of the synodic month: 0 new, 0.5 full. */
export function moonPhase(ms: number): number {
  const cycles = (ms - NEW_MOON_MS) / DAY_MS / SYNODIC_DAYS;
  return cycles - Math.floor(cycles);
}

/** Where the orb sits at `hour`: the sun from 6:00 to 19:00, highest at noon; the moon otherwise. */
function orbAt(hour: number, cols: number, rows: number): Orb {
  const h = wrapHour(hour);
  const x = cols - ORB_GAP;
  if (h < 6 || h > 19) return { kind: "moon", x, y: MOON_Y, r: ORB_R };
  const low = rows - 4;
  const y = h <= 12 ? low + (SUN_HIGH - low) * (h - 6) / 6 : SUN_HIGH + (low - SUN_HIGH) * (h - 12) / 7;
  return { kind: "sun", x, y: Math.round(y), r: ORB_R };
}

/** Whether offset (dx, dy) lies in a disc of radius r. The +1 rounds small discs into the usual pixel circle. */
function inDisc(dx: number, dy: number, r: number): boolean {
  return dx * dx + dy * dy <= r * r + 1;
}

/** The disc's pixel offsets, each flagged when a side of it touches outside the disc. */
function discCells(r: number): Array<[number, number, boolean]> {
  const cells: Array<[number, number, boolean]> = [];
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (!inDisc(dx, dy, r)) continue;
      const rim = !inDisc(dx + 1, dy, r) || !inDisc(dx - 1, dy, r) || !inDisc(dx, dy + 1, r) || !inDisc(dx, dy - 1, r);
      cells.push([dx, dy, rim]);
    }
  }
  return cells;
}

/** One scene pixel as a 1x1 rect, or nothing when it falls outside the scene. */
function pixel(x: number, y: number, fill: string, cols: number, rows: number): string {
  if (x < 0 || y < 0 || x >= cols || y >= rows) return "";
  return `<rect x="${x}" y="${y}" width="1" height="1" fill="${fill}"/>`;
}

/** A pale sun with a 1px rim and a pulsing glow ring. */
function sunSvg(orb: Orb, cols: number, rows: number): string {
  const at = (dx: number, dy: number, fill: string): string => pixel(orb.x + dx, orb.y + dy, fill, cols, rows);
  const glow = discCells(GLOW_R).map(([dx, dy]) => at(dx, dy, SUN)).join("");
  const body = discCells(orb.r).map(([dx, dy, rim]) => at(dx, dy, rim ? SUN_RIM : SUN)).join("");
  return `<g class="orb sun"><g class="glow" opacity=".2">` +
    `<animate attributeName="opacity" values=".12;.3;.12" dur="4s" repeatCount="indefinite"/>${glow}</g>${body}</g>`;
}

/**
 * A moon with its phase drawn as pixels: lit on the side the sun is on, the rest a dim disc with a faint edge. The half
 * pixel of depth keeps the limb lit at full and dark at new.
 */
function moonSvg(orb: Orb, phase: number, cols: number, rows: number): string {
  const theta = 2 * Math.PI * phase;
  const sin = Math.sin(theta);
  const cos = Math.cos(theta);
  const cells = discCells(orb.r).map(([dx, dy, rim]) => {
    const depth = Math.sqrt(Math.max(0, orb.r * orb.r - dx * dx - dy * dy)) + 0.5;
    const lit = dx * sin - depth * cos > 0;
    return pixel(orb.x + dx, orb.y + dy, lit ? CREAM : rim ? MOON_EDGE : MOON_DARK, cols, rows);
  });
  return `<g class="orb moon">${cells.join("")}</g>`;
}

/** Stars at `alpha`, each twinkling on its own slow cycle. */
function starsSvg(cols: number, rows: number, alpha: number): string {
  const rects = starPoints(cols, rows - 6, 6).map(([x, y, r], k) =>
    `<rect class="star" x="${x}" y="${y}" width="1" height="1" fill="${STAR}">` +
    `<animate attributeName="opacity" values=".2;1;.2" dur="${(2.6 + r * 3).toFixed(1)}s" ` +
    `begin="${((k * 0.53) % 3).toFixed(2)}s" repeatCount="indefinite"/></rect>`).join("");
  return `<g opacity="${alpha.toFixed(2)}">${rects}</g>`;
}

/** One cloud per shape, drifting right to left across the scene in the top half, each on its own staggered cycle. */
function cloudsSvg(cols: number, rows: number, fill: string, opacity: number): string {
  const spread = Math.max(1, Math.floor(rows / 2) - 3);
  return CLOUD_SHAPES.map((shape, i) => {
    const width = shape.reduce((m, [x, , w]) => Math.max(m, x + w), 0);
    const y0 = 1 + ((i * 5) % spread);
    const dur = 60 + 15 * i;
    const begin = -Math.round((dur * i) / 3);
    const rects = shape.map(([x, y, w, h]) => `<rect x="${x}" y="${y0 + y}" width="${w}" height="${h}"/>`).join("");
    return `<g class="cloud" fill="${fill}" opacity="${opacity.toFixed(2)}">` +
      `<animateTransform attributeName="transform" type="translate" values="${cols} 0;${-width} 0" ` +
      `dur="${dur}s" begin="${begin}s" repeatCount="indefinite"/>${rects}</g>`;
  }).join("");
}

/** The sky gradient filling the scene, from the top colour down to the horizon colour. */
function backdrop(cols: number, rows: number, palette: Palette): string {
  const stops = palette.map((colour, k) => `<stop offset="${k / 2}" stop-color="${colour}"/>`).join("");
  return `<defs><linearGradient id="hk-sky" x1="0" y1="0" x2="0" y2="1">${stops}</linearGradient></defs>` +
    `<rect x="0" y="0" width="${cols}" height="${rows}" fill="url(#hk-sky)"/>`;
}

function sceneGroup(parts: string[]): string {
  return `<g class="sky" shape-rendering="crispEdges">${parts.join("")}</g>`;
}

/**
 * SVG elements for a cols x rows scene and the orb's place on it. `opts.hour` is the live hour; the fixed modes
 * ignore it. Mode `off` returns only the orb, so the band stays transparent.
 */
export function skySvg(cols: number, rows: number, opts: { mode: SkyMode; hour: number; phase: number; clouds: boolean }): { body: string; orb: Orb } {
  const hour = skyHour(opts.mode, opts.hour);
  const orb = orbAt(hour, cols, rows);
  const orbSvg = orb.kind === "sun" ? sunSvg(orb, cols, rows) : moonSvg(orb, opts.phase, cols, rows);
  if (opts.mode === "off") return { body: sceneGroup([orbSvg]), orb };
  const parts = [backdrop(cols, rows, blend(hour, PALETTES, mixPalette))];
  const alpha = blend(hour, STAR_ALPHA, lerpNum);
  if (alpha > 0.01) parts.push(starsSvg(cols, rows, alpha));
  if (opts.clouds) {
    const day = blend(hour, DAYLIGHT, lerpNum);
    parts.push(cloudsSvg(cols, rows, lerpHex(CLOUD_NIGHT, CLOUD_DAY, day), lerpNum(0.6, 0.85, day)));
  }
  parts.push(orbSvg);
  return { body: sceneGroup(parts), orb };
}
