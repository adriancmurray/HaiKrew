/**
 * Background scenery for the band: one SVG fragment with sky, orb, three depth layers and ambient life. Pure: all
 * randomness is seeded, so equal arguments give equal markup.
 */
import { GROUND, H, SKY, W, darken, idMaker, lighten, mix } from "./common.ts";
import type { SkyPalette, TimeOfDay, Uid } from "./common.ts";
import type { Pt, Tower } from "./props.ts";
import { boxes, curve, f, item, openCurve, path, pines, ridge, ridgePts, seeded, skyline, snowcaps, stream, yAt } from "./props.ts";

/** The landscapes the band can show. */
export type SceneryKind = "hills" | "mountains" | "city" | "forest";
/** Every scenery kind. */
export const SCENERY_KINDS: SceneryKind[] = ["hills", "mountains", "city", "forest"];
/** Every time of day, in the order the band cycles through them. */
export const TIMES: TimeOfDay[] = ["dawn", "day", "dusk", "night"];
/** Which falling or drifting effects to add: autumn leaves, winter snow, or none. */
export type Season = "autumn" | "winter" | "none";

/** Options for scenery(). */
export interface SceneryOptions {
  /** Moon phase, 0 new to 0.5 full. Only used at night. */
  phase?: number;
  clouds?: boolean;
  season?: Season;
  /** Prefix for the ids this drawing makes. Defaults to "hk". */
  idPrefix?: string;
  /** Width of the drawing in scene pixels; everything spreads across it. Defaults to W. */
  width?: number;
}
/** What scenery() returns: the SVG fragment and the sun or moon it drew. */
export interface SceneryResult {
  svg: string;
  orb: { kind: "sun" | "moon"; x: number; y: number; r: number };
}

type Layers = [string, string, string];
interface Orb { kind: "sun" | "moon"; x: number; y: number; r: number; svg: string }
interface Ctx {
  id: Uid;
  defs: string[];
  dark: boolean;
  seed: number;
  cols: Layers;
  base: Layers;
  haze: string;
  width: number;
}

const BASE: Record<SceneryKind, Layers> = {
  hills: ["#6b9a5c", "#4f7d4a", "#36603e"],
  mountains: ["#7a8bb0", "#56668c", "#363f63"],
  city: ["#8190aa", "#5a6686", "#33405e"],
  forest: ["#5c8a72", "#3e6b58", "#24493d"],
};
const SHADE: Record<TimeOfDay, number> = { dawn: 0.1, day: 0, dusk: 0.15, night: 0.55 };
const SEED: Record<SceneryKind, number> = { hills: 100, mountains: 200, city: 300, forest: 400 };
const HILL_BANDS: [number, number][] = [[48, 16], [58, 12], [68, 8]];
// The tall tower and the shooting star sit at the same places in a band of any width, as fractions of it.
const TOWER_AT = 670 / W;
const STAR_AT = 740 / W;
const WING_UP = "M-4,-1.5Q-2,-4 0,0Q2,-4 4,-1.5";
const WING_DOWN = "M-4,1Q-2,-1.2 0,0Q2,-1.2 4,1";
const LEAF = ["#d9822b", "#c0492a", "#e0a526", "#b5532a"];
const PUFFS: [number, number, number][][] = [
  [[0, 0, 7], [9, -3, 9], [20, 0, 7], [-8, 2, 5]],
  [[0, 1, 6], [7, -2, 8], [16, 1, 6], [25, 2, 4]],
];
// Past this width the scenery's counts stop growing: buildings and trees widen instead, so the markup stays near its
// size at this width and the band's drawing stays under the Svg source limit at any width.
// ponytail: past this width the city's windows look stretched, not redrawn. The upgrade is a second set of buildings
// drawn at the wider width, which costs markup in proportion to the width.
const DETAIL_WIDTH = 1200;
const SUN_Y: Record<"dawn" | "day" | "dusk", number> = { dawn: 40, day: 22, dusk: 42 };
const SUN_COL: Record<"dawn" | "day" | "dusk", string> = { dawn: "#ffd2a0", day: "#fff2bf", dusk: "#ffb27c" };
const CLOUD_COL: Record<TimeOfDay, string> = { dawn: "#f6c3b0", day: "#ffffff", dusk: "#f2a58c", night: "#6c7ba6" };
const CLOUD_OP: Record<TimeOfDay, number> = { dawn: 0.8, day: 0.9, dusk: 0.8, night: 0.3 };
const AURORA: [number, number, number][] = [[6, 14, 17], [14, 9, 23]];

/** Registers a def under a call-unique id; markup(id) builds it. */
function addDef(ctx: Ctx, name: string, markup: (id: string) => string): string {
  const id = ctx.id(name);
  ctx.defs.push(markup(id));
  return id;
}
const glowDef = (ctx: Ctx, color: string, alpha: number): string =>
  addDef(ctx, "rg", (id) => `<radialGradient id="${id}"><stop offset="0" stop-color="${color}" stop-opacity="${alpha}"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>`);
const blurDef = (ctx: Ctx, sd: number): string =>
  addDef(ctx, "bl", (id) => `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${sd}"/></filter>`);

/** Hills: three smooth rolling bands, each lighter toward the back. */
function hillsLayers(ctx: Ctx): Layers {
  const [a, b, c] = HILL_BANDS.map(([base, amp], i) => path(item(ctx.cols, i), ridge(ridgePts(ctx.seed + i + 1, base, amp, 200, 1, ctx.width))));
  return [a ?? "", b ?? "", c ?? ""];
}

/** Mountains: a snowcapped far range, a mid range, and near foothills with a few pines. */
function mountainsLayers(ctx: Ctx): Layers {
  const { seed, cols, width } = ctx;
  const far = ridgePts(seed + 1, 50, 34, 90, 1.4, width);
  const mid = ridgePts(seed + 2, 58, 22, 70, 1.3, width);
  const near = ridgePts(seed + 3, 72, 10, 120, 1, width);
  const sil = ridge(far);
  const clip = addDef(ctx, "cp", (id) => `<clipPath id="${id}"><path d="${sil}"/></clipPath>`);
  const snow = mix(lighten(ctx.base[0], 0.6), ctx.haze, 0.75);
  return [
    path(cols[0], sil) + path(snow, snowcaps(far, 50, 34), ` clip-path="url(#${clip})"`),
    path(cols[1], ridge(mid)),
    path(cols[2], ridge(near)) + path(cols[2], pines(seed + 4, near, 12, 6, 9, 2, width)),
  ];
}

/** Forest: tree-textured far hills, a mid line of pines, and larger pines with round trees up front. */
function forestLayers(ctx: Ctx): Layers {
  const { seed, cols, width } = ctx;
  const hills = ridgePts(seed, 54, 16, 160, 1, width);
  const crown: Pt[] = [];
  // The crown's points are spaced wider past DETAIL_WIDTH, so their number stops growing with the band.
  const step = 7 * Math.max(1, width / DETAIL_WIDTH);
  for (let i = 0, x = -7; x <= width + 7; i++, x += step) crown.push([x, yAt(hills, x) - 1 - 5 * seeded(seed + 1, i)]);
  const mid = ridgePts(seed + 2, 60, 10, 200, 1, width);
  const near = ridgePts(seed + 4, 70, 6, 240, 1, width);
  const jit = stream(seed + 6);
  let round = "";
  for (const u of [0.2, 0.74]) {
    const x = u * width + (jit() - 0.5) * 60, base = yAt(near, x) + 2, rr = 6 + 2 * jit();
    round += `<circle cx="${f(x)}" cy="${f(base - rr - 3)}" r="${f(rr)}" fill="${cols[2]}"/>` + path(cols[2], `M${f(x - 1)},${f(base - 4)}h2v5h-2z`);
  }
  return [
    path(cols[0], ridge(crown)),
    path(cols[1], ridge(mid)) + path(cols[1], pines(seed + 3, mid, 60, 12, 17, 3, width)),
    path(cols[2], ridge(near)) + path(cols[2], pines(seed + 5, near, 14, 20, 28, 2, width)) + round,
  ];
}

/** City: a hazy far skyline, mid towers with window grids and one tall tower, and low near rooftops with lamp posts. */
function cityLayers(ctx: Ctx): Layers {
  const { seed, cols, width } = ctx;
  // Past DETAIL_WIDTH the skylines are drawn at that width and stretched across the rest, so their count stops growing.
  const base = Math.min(width, DETAIL_WIDTH), k = width / base, inner: Ctx = { ...ctx, width: base };
  const far = boxes(seed + 1, 62, 8, 26, 5, 10, base);
  const mid = boxes(seed + 2, H, 22, 52, 10, 22, base);
  const near = boxes(seed + 3, GROUND, 4, 10, 9, 16, base);
  const stretched = (svg: string): string => (k > 1 ? `<g transform="scale(${k} 1)">${svg}</g>` : svg);
  return [
    stretched(path(cols[0], skyline(far))),
    stretched(path(cols[1], skyline(mid)) + windows(inner, mid, seed + 4) + tower(cols[1], base)),
    stretched(path(cols[2], skyline(near))) + lamps(ctx, seed + 5),
  ];
}

/** Window grid for the mid towers: dim by day; at dusk and night most are warm and lit, and a few blink on slow cycles. */
function windows(ctx: Ctx, list: Tower[], seed: number): string {
  const r = stream(seed), dimCol = darken(ctx.cols[1], ctx.dark ? 0.45 : 0.22);
  let dim = "", lit = "", blink = "", blinks = 0;
  for (const b of list) {
    for (let x = b.x + 2; x + 2 <= b.x + b.w - 1; x += 4) {
      for (let y = b.top + 4; y <= 64; y += 5) {
        const q = `M${f(x)},${f(y)}h2v3h-2z`, roll = r();
        if (!ctx.dark || roll < 0.4) {
          dim += q;
        } else if (blinks < 10 && r() < 0.02) {
          blinks++;
          blink += `<rect x="${f(x)}" y="${f(y)}" width="2" height="3" fill="#ffd98a"><animate attributeName="opacity" values="1;0.1;1" keyTimes="0;0.5;1" dur="${f(11 + r() * 12)}s" begin="${f(-r() * 15)}s" repeatCount="indefinite"/></rect>`;
        } else {
          lit += q;
        }
      }
    }
  }
  return path(dimCol, dim) + path("#ffd98a", lit, ' opacity="0.9"') + blink;
}

/** The tall tower with its blinking red light, drawn over the window grid so it reads as one mass. */
function tower(col: string, width: number): string {
  const x = f(width * TOWER_AT);
  const light = `<circle cx="${x}" cy="2" r="1.1" fill="#ff4d4d"><animate attributeName="opacity" values="1;0.15;1;1" keyTimes="0;0.1;0.2;1" dur="2.4s" repeatCount="indefinite"/></circle>`;
  return path(col, `M${x - 3.5},${H}V6H${x - 0.4}V0H${x + 0.4}V6H${x + 3.5}V${H}Z`) + light;
}

/** Lamp posts along the near street; their lamps glow at dusk and night. */
function lamps(ctx: Ctx, seed: number): string {
  const r = stream(seed), glow = glowDef(ctx, "#ffd98a", 0.85), bulb = ctx.dark ? "#ffe3a6" : "#d9d4bd";
  let posts = "", heads = "", glows = "";
  for (let i = 0; i < 9; i++) {
    const x = f((i + 0.5) * (ctx.width / 9) + (r() - 0.5) * 24);
    posts += `M${f(x - 0.6)},50h1.2V${GROUND}h-1.2Z`;
    heads += `<circle cx="${x}" cy="49.5" r="1.3" fill="${bulb}"/>`;
    if (ctx.dark) glows += `<circle cx="${x}" cy="50" r="7" fill="url(#${glow})"/>`;
  }
  return path(ctx.cols[2], posts) + heads + glows;
}

/** Vertical sky gradient through the palette's top, mid and bottom colours. */
function sky(ctx: Ctx, pal: SkyPalette): string {
  const id = addDef(ctx, "sky", (gid) => `<linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${pal.top}"/><stop offset="0.55" stop-color="${pal.mid}"/><stop offset="1" stop-color="${pal.bot}"/></linearGradient>`);
  return `<rect width="${ctx.width}" height="${H}" fill="url(#${id})"/>`;
}

/** 120 twinkling stars across the whole width: full at night, faint at dawn and dusk, none by day. */
function stars(time: TimeOfDay, width: number): string {
  if (time === "day") return "";
  const r = stream(7), night = time === "night", lo = night ? 0.15 : 0.02, hi = night ? 1 : 0.3;
  let out = "";
  for (let i = 0; i < 120; i++) {
    const x = f(r() * width), y = f(2 + r() * 48), rad = f(0.3 + r() * 0.7), dur = f(2 + r() * 4), begin = f(-r() * dur);
    out += `<circle cx="${x}" cy="${y}" r="${rad}" fill="#fff"><animate attributeName="opacity" values="${lo};${hi};${lo}" dur="${dur}s" begin="${begin}s" repeatCount="indefinite"/></circle>`;
  }
  return out;
}

/** Mask content for the lit part of a moon of radius r at the origin. phase 0 is new, 0.5 full. */
function moonLit(phase: number, r: number): string {
  const p = ((phase % 1) + 1) % 1, k = Math.cos(2 * Math.PI * p);
  const side = p < 0.5 ? 1 : -1; // waxing lights the right limb, waning the left
  const half = (s: number, rx: number): string => `M0,${-r}A${f(Math.abs(rx))},${r} 0 0 ${s > 0 ? 1 : 0} 0,${r}Z`;
  const limb = `<path fill="#fff" d="${half(side, r)}"/>`;
  return k >= 0
    ? limb + `<path fill="#000" d="${half(side, r * k)}"/>`
    : limb + `<path fill="#fff" d="${half(-side, r * -k)}"/>`;
}

/** The sun at dawn, day and dusk; the moon at night, with its lit part drawn through a mask. */
function orb(ctx: Ctx, time: TimeOfDay, phase: number): Orb {
  const x = ctx.width - 30;
  if (time !== "night") {
    const y = SUN_Y[time], r = 9, col = SUN_COL[time];
    const glow = glowDef(ctx, col, 0.9);
    const svg = `<circle cx="${x}" cy="${y}" r="30" fill="url(#${glow})"><animate attributeName="opacity" values="0.55;0.95;0.55" dur="7s" repeatCount="indefinite"/></circle><circle cx="${x}" cy="${y}" r="${r}" fill="${col}"/>`;
    return { kind: "sun", x, y, r, svg };
  }
  const y = 20, r = 10;
  const glow = glowDef(ctx, "#c9d6ff", 0.4);
  const mask = addDef(ctx, "mk", (id) => `<mask id="${id}" maskUnits="userSpaceOnUse" x="${x - r - 2}" y="${y - r - 2}" width="${2 * r + 4}" height="${2 * r + 4}"><g transform="translate(${x} ${y})">${moonLit(phase, r)}</g></mask>`);
  const svg = `<circle cx="${x}" cy="${y}" r="26" fill="url(#${glow})"/><circle cx="${x}" cy="${y}" r="${r}" fill="#33416e"/><circle cx="${x}" cy="${y}" r="${r}" fill="#f4efd4" mask="url(#${mask})"/>`;
  return { kind: "moon", x, y, r, svg };
}

/** A shooting star every 12 s: the head travels down-left at 25 degrees for about 1.4 s, the trail points back along that line, and the star fades in and out. */
function shootingStar(ctx: Ctx): string {
  const a = (25 * Math.PI) / 180, ux = -Math.cos(a), uy = Math.sin(a);
  const len = 40, dist = 150;
  const tailX = f(-ux * len), tailY = f(-uy * len);
  const g = addDef(ctx, "ss", (gid) => `<linearGradient id="${gid}" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${tailX}" y2="${tailY}"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>`);
  const tx = f(ux * dist), ty = f(uy * dist);
  return `<g transform="translate(${f(ctx.width * STAR_AT)} 16)"><g><animateTransform attributeName="transform" type="translate" values="0 0;${tx} ${ty};${tx} ${ty}" keyTimes="0;0.12;1" dur="12s" repeatCount="indefinite"/><animate attributeName="opacity" values="0;1;1;0;0" keyTimes="0;0.02;0.1;0.12;1" dur="12s" repeatCount="indefinite"/><path d="M0,0L${tailX},${tailY}" fill="none" stroke="url(#${g})" stroke-width="1.2" stroke-linecap="round"/><circle r="1" fill="#fff"/></g></g>`;
}

/** Two soft teal-green ribbons across the upper sky, blurred, with slowly shifting opacity. */
function aurora(ctx: Ctx): string {
  const bl = blurDef(ctx, 3), r = stream(12);
  const grad = addDef(ctx, "au", (gid) => `<linearGradient id="${gid}"><stop offset="0" stop-color="#3ee6a6" stop-opacity="0"/><stop offset="0.5" stop-color="#3ee6a6"/><stop offset="1" stop-color="#2fc7c9" stop-opacity="0"/></linearGradient>`);
  return AURORA.map(([y0, thick, dur]) => {
    const top: Pt[] = [], bot: Pt[] = [];
    for (let x = -120; x <= ctx.width + 120; x += 120) {
      const y = y0 + 6 * r();
      top.push([x, y]);
      bot.push([x, y + thick * (0.6 + 0.4 * r())]);
    }
    const end = item(bot, bot.length - 1);
    return `<path opacity="0.2" fill="url(#${grad})" filter="url(#${bl})" d="${openCurve(top)}L${f(end[0])},${f(end[1])}${curve(bot.reverse())}Z"><animate attributeName="opacity" values="0.08;0.4;0.15;0.35;0.08" dur="${dur}s" repeatCount="indefinite"/></path>`;
  }).join("");
}

/** Three soft clouds drifting right to left across the full width on long, staggered loops. */
function cloudLayer(ctx: Ctx, time: TimeOfDay): string {
  const bl = blurDef(ctx, 2);
  const specs: [number, number, number, number][] = [[12, 1, 118, 0], [25, 0.8, 146, -47], [10, 1.2, 171, -93]];
  const body = specs.map(([y, s, dur, begin], i) => {
    const puffs = item(PUFFS, i % 2).map(([dx, dy, r]) => `<circle cx="${f(dx * s)}" cy="${f(dy * s)}" r="${f(r * s)}"/>`).join("");
    return `<g><animateTransform attributeName="transform" type="translate" from="${ctx.width + 80} ${y}" to="-80 ${y}" dur="${dur}s" begin="${begin}s" repeatCount="indefinite"/>${puffs}</g>`;
  }).join("");
  return `<g filter="url(#${bl})" fill="${CLOUD_COL[time]}" opacity="${CLOUD_OP[time]}">${body}</g>`;
}

/** Three small birds crossing slowly by day, wings flapping by animating the path. */
function birds(width: number): string {
  const r = stream(9);
  let out = "";
  for (let i = 0; i < 3; i++) {
    const y = f(10 + r() * 22), dur = f(55 + r() * 35), begin = f(-r() * dur), s = f(0.8 + r() * 0.5);
    out += `<g><animateTransform attributeName="transform" type="translate" from="-12 ${y}" to="${width + 12} ${y}" dur="${dur}s" begin="${begin}s" repeatCount="indefinite"/><path transform="scale(${s})" fill="none" stroke="#2c3b58" stroke-width="1.1" stroke-linecap="round" d="${WING_UP}"><animate attributeName="d" values="${WING_UP};${WING_DOWN};${WING_UP}" dur="0.9s" repeatCount="indefinite"/></path></g>`;
  }
  return out;
}

/** Snow flurries: small dots falling with a gentle sideways drift, looping. */
function snow(width: number): string {
  const r = stream(10);
  let out = "";
  for (let i = 0; i < 22; i++) {
    const x = f(r() * width), rad = f(0.6 + r() * 0.7), dur = f(6 + r() * 6), begin = f(-r() * dur), dx = f(-8 + r() * 16);
    out += `<circle cx="${x}" cy="-2" r="${rad}" fill="#f5f9ff" opacity="0.9"><animateTransform attributeName="transform" type="translate" values="0 0;${dx} ${H + 4}" dur="${dur}s" begin="${begin}s" repeatCount="indefinite"/></circle>`;
  }
  return out;
}

/** A few autumn leaves falling and swaying down the band. */
function leaves(width: number): string {
  const r = stream(11);
  let out = "";
  for (let i = 0; i < 5; i++) {
    const x = f(r() * width), dx = f(-30 + r() * 60), dur = f(14 + r() * 10), begin = f(-r() * dur), sway = f(2.5 + r() * 2);
    out += `<g><animateTransform attributeName="transform" type="translate" values="${x} -3;${f(x + dx)} ${H + 3}" dur="${dur}s" begin="${begin}s" repeatCount="indefinite"/><path fill="${LEAF[i % LEAF.length]}" d="M0,0q2.5,-2.5 5,0q-2.5,2.5 -5,0z"><animateTransform attributeName="transform" type="rotate" values="-35 2.5 0;35 2.5 0;-35 2.5 0" dur="${sway}s" repeatCount="indefinite"/></path></g>`;
  }
  return out;
}

/** Fireflies: small yellow-green glows looping slowly over the trees, pulsing as they go. */
function fireflies(ctx: Ctx, seed: number): string {
  const r = stream(seed), glow = glowDef(ctx, "#e4ff7a", 0.9), k = (): number => f((r() - 0.5) * 18);
  let out = "";
  for (let i = 0; i < 7; i++) {
    const x = f(20 + r() * (ctx.width - 40)), y = f(34 + r() * 30), dur = f(9 + r() * 7), begin = f(-r() * dur);
    const loop = `M0,0c${k()},${k()} ${k()},${k()} 0,0`;
    out += `<g><animateMotion path="${loop}" dur="${dur}s" begin="${begin}s" repeatCount="indefinite"/><circle cx="${x}" cy="${y}" r="3.2" fill="url(#${glow})"><animate attributeName="opacity" values="0.2;1;0.2" dur="${f(2.4 + r() * 2)}s" repeatCount="indefinite"/></circle><circle cx="${x}" cy="${y}" r="0.9" fill="#f2ffb8"/></g>`;
  }
  return out;
}

const LAYERS: Record<SceneryKind, (ctx: Ctx) => Layers> = {
  hills: hillsLayers, mountains: mountainsLayers, city: cityLayers, forest: forestLayers,
};

/**
 * The band's background as one SVG fragment, `width` scene pixels wide and H tall.
 * kind: "hills" | "mountains" | "city" | "forest"; time: "dawn" | "day" | "dusk" | "night".
 * Returns { svg, orb: { kind, x, y, r } }, where orb is the sun or the moon.
 */
export function scenery(kind: SceneryKind, time: TimeOfDay, opts: SceneryOptions = {}): SceneryResult {
  const { phase = 0.05, clouds = true, season = "autumn", idPrefix = "hk", width = W } = opts;
  const pal = SKY[time], shade = SHADE[time];
  const [b0, b1, b2] = BASE[kind];
  const base: Layers = [darken(b0, shade), darken(b1, shade), darken(b2, shade)];
  const cols: Layers = [mix(base[0], pal.haze, 0.75), mix(base[1], pal.haze, 0.45), mix(base[2], pal.haze, 0.15)];
  const ctx: Ctx = {
    id: idMaker(idPrefix), defs: [], dark: time === "dusk" || time === "night",
    seed: SEED[kind], cols, base, haze: pal.haze, width,
  };
  const [far, mid, near] = LAYERS[kind](ctx);
  const o = orb(ctx, time, phase);
  const parts = [sky(ctx, pal), stars(time, width)];
  if (kind === "mountains" && time === "night") parts.push(aurora(ctx));
  parts.push(o.svg);
  if (time === "night") parts.push(shootingStar(ctx));
  if (clouds) parts.push(cloudLayer(ctx, time));
  parts.push(far, mid, near, `<rect x="0" y="${GROUND}" width="${width}" height="${H - GROUND}" fill="${cols[2]}"/>`);
  if (kind === "forest" && ctx.dark) parts.push(fireflies(ctx, ctx.seed + 20));
  if (time === "day") parts.push(birds(width));
  if (season === "winter") parts.push(snow(width));
  if (season === "autumn" && (kind === "forest" || kind === "hills")) parts.push(leaves(width));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${H}"><defs>${ctx.defs.join("")}</defs>${parts.join("")}</svg>`;
  return { svg, orb: { kind: o.kind, x: o.x, y: o.y, r: o.r } };
}
