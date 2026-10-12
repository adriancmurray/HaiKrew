/**
 * The desktop band's critters: the pixel sprite, the pose each activity gives it, the headwear the lead may wear, and
 * the animated SVG scene that lays the crew out on a transparent background. Pure; all motion is SMIL in the drawing.
 */
import { modelFamily } from "./crew.ts";
import type { Crew, Lead, Row } from "./crew.ts";

/** Pixel rows of the desktop band's animated scene, taller than the terminal's so critters can scale up. */
export const SVG_ROWS = 22;
/** The lead's column on the scene; the terminal's scene uses the same one. */
export const LEAD_X = 2;
/** Sprite rows: o body, e eye, s shade. The two legs are the shade pixels on the bottom row. */
export const CRITTER = [
  ".ooooo.",
  "ooooooo",
  "ooeoeoo",
  "ooooooo",
  ".ooooo.",
  "..s.s..",
];
const CRITTER_ROWS = CRITTER.length;
const FEET = SVG_ROWS - 1;
// ponytail: arms are one sprite pixel past the body, so at the largest scales a neighbour's arm can touch ours. A wider
// GAP would clear that but fit fewer critters; upgrade by widening GAP per scale if the band looks cramped.
const GAP = 2;
// Room after the lead for the indicator beside its head (baton, hourglass, bubble, z), clear of the next bubble.
const LEAD_GAP = 8;
const LEAD_SCALE = 1.35;
const EYE_X = [2, 4];
// How far each activity's prop reaches past the body's seven columns, in sprite pixels. The arms' own pixel is left
// to the gap between critters.
const PROP_SPAN: Partial<Record<Activity, number>> = { editing: 2, running: 6 };
// How far each headwear rises above the sprite's top row.
const HEAD_HEIGHT: Record<SceneOpts["headwear"], number> = { crown: 2, wizard: 4, cap: 2, none: 0 };
const ZED = ["###", "..#", ".#.", "#..", "###"];
const HOURGLASS = ["###", ".#.", ".#.", "###"];
const GOLD = 0xe8b931;
const GREEN = 0x5aa469;
const PURPLE = 0x6b4fa8;
const RED = 0xd0533f;
const SCREEN = 0x1b1a19;
const SCREEN_EDGE = 0x4f9c98;
/** The lead's and agents' highlight cream: the baton, the book's pages, the hourglass. */
export const CREAM = 0xffe9c7;
/** The eyes and the dark marks on a prop. */
export const EYE = 0x1b1420;
/** The orange of the Opus family, also the banner's face. */
export const ORANGE = 0xd97757;

type Family = ReturnType<typeof modelFamily>;
const SCALE: Record<Family, number> = { haiku: 1, sonnet: 1.2, opus: 1.4, unknown: 1 };
/** Each model family's body colour. */
export const MODEL_BODY: Record<Family, number> = { haiku: 0x9b7fc7, sonnet: 0x4f9c98, opus: ORANGE, unknown: 0x8a8f9c };

/** What a critter is doing, as its pose shows it. */
export type Activity = "thinking" | "reading" | "editing" | "running" | "web" | "directing" | "done" | "failed";

const TOOL_ACTIVITY = new Map<string, Activity>([
  ["Read", "reading"], ["Grep", "reading"], ["Glob", "reading"], ["LS", "reading"], ["NotebookRead", "reading"],
  ["Edit", "editing"], ["Write", "editing"], ["MultiEdit", "editing"], ["NotebookEdit", "editing"],
  ["Bash", "running"],
  ["WebSearch", "web"], ["WebFetch", "web"],
  ["Agent", "directing"], ["Task", "directing"],
]);

/** The activity a roster row shows: its end state, else the family of its latest tool call, else thinking. */
export function activityOf(row: Row): Activity {
  if (row.state === "done" || row.state === "failed") return row.state;
  return TOOL_ACTIVITY.get(row.last.split(" ")[0] ?? "") ?? "thinking";
}

/** The scene's colours on one background: the ground line and stars from the ink, the bubble behind "…". */
export type SceneInk = { star: string; ground: string; bubble: string; bubbleText: string };
/**
 * Options for the desktop band's scene: the lead's headwear, body colours per model family, a background drawn behind
 * the crew (the scene then leaves out its own stars), and columns kept free at the right.
 */
export type SceneOpts = {
  headwear: "crown" | "wizard" | "cap" | "none";
  colors?: { haiku?: string; sonnet?: string; opus?: string };
  background?: string;
  reserveRight?: number;
};
/** Where one drawn critter stands on the desktop band, in scene pixels: its Row id, or "lead" for the lead. */
export type Spot = { id: string; x: number; w: number; top: number };

type Eyes = "open" | "shut" | "glance" | "x";
/** A pose: its eyes (on row `eyeRow`), its arms and the prop beside it, all in sprite coordinates. */
type Pose = { eyes: Eyes; eyeRow: number; arms: string; prop: string };
/** One critter drawn: its body colour, scale, centre x, blink period, pose and headwear SVG. */
type Stance = { body: number; k: number; cx: number; blink: number; pose: Pose; head: string };
type Palette = Record<Family, number>;

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
export function shade(body: number): number {
  return mix(body, 0, 0.35);
}

/** A colour as a CSS hex string. */
export function hex(c: number): string {
  return `#${c.toString(16).padStart(6, "0")}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** The `w` by `h` block at (x, y) in `fill`, in the coordinates of whatever transform encloses it. */
function rect(x: number, y: number, fill: string, w = 1, h = 1): string {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;
}

/** A bitmap's marked pixels as rects with its top-left at (x0, y0); each mark picks its colour from `colours`. */
function pixels(rows: string[], x0: number, y0: number, colours: Record<string, string>): string {
  return rows.map((line, y) => [...line].map((ch, x) => (colours[ch] ? rect(x0 + x, y0 + y, colours[ch]) : "")).join("")).join("");
}

/** The sprite's pixels whose glyph is in `glyphs`, in colour `c`, as rects in sprite coordinates. */
function spritePixels(glyphs: string, c: number): string {
  return CRITTER.map((line, y) => [...line].map((ch, x) => (glyphs.includes(ch) ? rect(x, y, hex(c)) : "")).join("")).join("");
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
export function starRects(points: Array<[number, number, number]>, color: string): string {
  return points.map(([x, y, r], k) => `<rect x="${x}" y="${y}" width="1" height="1" fill="${color}" opacity=".3">` +
    `<animate attributeName="opacity" values=".15;.9;.15" dur="${(2.6 + r * 3).toFixed(1)}s" begin="${((k * 0.53) % 3).toFixed(2)}s" repeatCount="indefinite"/></rect>`).join("");
}

/** The lead's headwear as SVG, in sprite coordinates above the head: a crown, a wizard's cone, or a cap. */
function headwearSvg(kind: SceneOpts["headwear"]): string {
  switch (kind) {
    case "crown":
      return `<g class="headwear-crown">${pixels(["#.#.#", "#####"], 1, -2, { "#": hex(GOLD) })}</g>`;
    case "wizard":
      return `<g class="headwear-wizard">${pixels(["..#..", ".###.", ".#*#.", "#####"], 1, -4, { "#": hex(PURPLE), "*": hex(GOLD) })}</g>`;
    case "cap":
      return `<g class="headwear-cap">${pixels(["#####", "#####"], 1, -2, { "#": hex(RED) })}${rect(6, -1, hex(RED), 2)}</g>`;
    case "none":
      return "";
  }
}

/** The body colour per family: the defaults, or the settings' colours where they are 6-digit hex. */
function palette(colors: SceneOpts["colors"]): Palette {
  const pick = (c: string | undefined, fallback: number): number =>
    c && /^#[0-9a-f]{6}$/i.test(c) ? parseInt(c.slice(1), 16) : fallback;
  return {
    haiku: pick(colors?.haiku, MODEL_BODY.haiku),
    sonnet: pick(colors?.sonnet, MODEL_BODY.sonnet),
    opus: pick(colors?.opus, MODEL_BODY.opus),
    unknown: MODEL_BODY.unknown,
  };
}

/** The pose an activity gives a critter of body colour `body`: arms down and open eyes, unless the activity moves them. */
function poseOf(activity: Activity, body: number, ink: SceneInk): Pose {
  const c = hex(shade(body));
  const left = rect(-1, 2, c, 1, 2);
  const right = rect(7, 2, c, 1, 2);
  const arms = `<g class="arms">${left}${right}</g>`;
  const prop = (inner: string): string => `<g class="act-${activity}">${inner}</g>`;
  switch (activity) {
    case "reading":
      return { eyes: "open", eyeRow: 3, arms: `<g class="arms" transform="translate(0 1)">${left}${right}</g>`,
        prop: prop(pixels(["ccecc"], 1, 4, { c: hex(CREAM), e: hex(EYE) })) };
    case "editing": {
      const swing = `<animateTransform attributeName="transform" type="translate" values="0 0;0 1" calcMode="discrete" dur="0.5s" repeatCount="indefinite"/>`;
      return { eyes: "open", eyeRow: 2, arms: `<g class="arms">${left}<g>${swing}${right}</g></g>`,
        prop: prop(`<g>${swing}${rect(8, 2, hex(GOLD), 1, 2)}${rect(8, 4, hex(EYE))}</g>`) };
    }
    case "running": {
      const cursor = `<rect x="9" y="2" width="1" height="1" fill="${hex(GREEN)}"><animate attributeName="opacity" ` +
        `values="1;0" calcMode="discrete" dur="1s" repeatCount="indefinite"/></rect>`;
      return { eyes: "open", eyeRow: 2, arms, prop: prop(rect(8, 1, hex(SCREEN_EDGE), 5, 4) + rect(9, 2, hex(SCREEN), 3, 2) + cursor) };
    }
    case "web": {
      const pulse = (begin: string, dots: string): string => `<g><animate attributeName="opacity" values=".2;1;.2" ` +
        `dur="1.2s" begin="${begin}" repeatCount="indefinite"/>${dots}</g>`;
      const antenna = rect(3, -3, c, 1, 3);
      return { eyes: "open", eyeRow: 2, arms, prop: prop(antenna + pulse("0s", rect(2, -4, ink.star) + rect(1, -5, ink.star)) +
        pulse("0.6s", rect(4, -4, ink.star) + rect(5, -5, ink.star))) };
    }
    case "directing": {
      const baton = `<g class="baton">${rect(7, -4, hex(CREAM), 1, 2)}<animateTransform attributeName="transform" type="translate" ` +
        `values="0 0;0 1" calcMode="discrete" dur="0.6s" repeatCount="indefinite"/></g>`;
      return { eyes: "open", eyeRow: 2, arms: `<g class="arms">${left}${rect(7, -1, c, 1, 2)}</g>`, prop: prop(baton) };
    }
    case "done":
      return { eyes: "shut", eyeRow: 2, arms, prop: prop(pixels(["...#", "#.#.", ".#.."], 0, -3, { "#": hex(GREEN) })) };
    case "failed":
      return { eyes: "x", eyeRow: 2, arms, prop: prop("") };
    case "thinking":
      return { eyes: "open", eyeRow: 2, arms, prop: prop("") };
  }
}

/** The eyes on the pose's row: open (a shade lid closes them every `blink` seconds), shut, glancing, or crossed out. */
function eyesSvg(s: Stance): string {
  const y = s.pose.eyeRow;
  const pair = (c: number): string => EYE_X.map((x) => rect(x, y, hex(c))).join("");
  switch (s.pose.eyes) {
    case "open":
      return pair(EYE) + `<g opacity="0">${pair(shade(s.body))}<animate attributeName="opacity" values="0;0;1;0" ` +
        `keyTimes="0;0.92;0.96;1" dur="${s.blink.toFixed(1)}s" repeatCount="indefinite"/></g>`;
    case "shut":
      return pair(shade(s.body));
    case "glance":
      return `<g><animateTransform attributeName="transform" type="translate" values="-0.5 0;0.5 0" calcMode="discrete" ` +
        `dur="2s" repeatCount="indefinite"/>${pair(EYE)}</g>`;
    case "x":
      return EYE_X.map((x) => rect(x, y, hex(EYE)) + rect(x + 1, y + 1, hex(EYE))).join("");
  }
}

/**
 * A critter in sprite coordinates, its feet on the ground line at `cx` and scaled by `k`: legs, arms, body, then its
 * eyes, prop and headwear. The legs group holds exactly the two leg pixels.
 */
function figure(s: Stance): string {
  return `<g transform="translate(${round2(s.cx)} ${FEET}) scale(${round2(s.k)}) translate(-3.5 -${CRITTER_ROWS})">` +
    `<g class="legs">${spritePixels("s", shade(s.body))}</g>${s.pose.arms}${spritePixels("oe", s.body)}` +
    `${eyesSvg(s)}${s.pose.prop}${s.head}</g>`;
}

/** How far a row's drawn prop sticks out past its body, in sprite pixels: none once the row is over the warning. */
function rowSpan(row: Row): number {
  return row.over ? 0 : (PROP_SPAN[activityOf(row)] ?? 0);
}

/**
 * The crew as one animated SVG on a transparent background, `SVG_ROWS` pixels tall, so the panel shows through. The
 * lead stands at the left, sized by its model and a further `LEAD_SCALE`; each agent follows, sized by its model. Each
 * critter poses for its activity; working agents think under a "…" bubble, finished ones stand dimmed. A critter whose
 * extent would pass the right edge, less `reserveRight`, is left out and counted as overflow.
 */
export function animatedSceneSvg(crew: Crew, cols: number, ink: SceneInk, opts: SceneOpts = { headwear: "crown" }): { svg: string; overflow: number; spots: Spot[] } {
  const lead: Lead = crew.lead ?? { state: crew.working > 0 ? "directing" : "resting", model: "opus" };
  const colours = palette(opts.colors);
  const leadK = SCALE[modelFamily(lead.model)] * LEAD_SCALE;
  const leadSpan = lead.state === "working" ? (PROP_SPAN.editing ?? 0) : 0;
  const limit = cols - 1 - (opts.reserveRight ?? 0);
  const spots: Spot[] = [{ id: "lead", x: LEAD_X, w: round2(7 * leadK), top: round2(FEET - (CRITTER_ROWS + HEAD_HEIGHT[opts.headwear]) * leadK) }];
  const parts: string[] = [];
  let right = LEAD_X + (7 + leadSpan) * leadK;
  let drawn = 0;
  for (const row of crew.rows) {
    const k = SCALE[modelFamily(row.model)];
    const span = rowSpan(row);
    const x = right + (drawn === 0 ? LEAD_GAP : GAP);
    // The arm's tip (one pixel past the body) and the prop's reach both have to fit.
    if (x + (8 + span) * k > limit) break;
    parts.push(rowSvg(row, x, k, drawn, ink, colours));
    spots.push({ id: row.id, x: round2(x), w: round2(7 * k), top: round2(FEET - CRITTER_ROWS * k) });
    right = x + (7 + span) * k;
    drawn++;
  }
  // Last, so the lead's indicator beside its head is not hidden under the next agent's bubble.
  parts.push(leadSvg(lead, opts, colours[modelFamily(lead.model)], ink));
  // A background supplied by the caller replaces the scene's own stars.
  const stars = opts.background ? "" : starRects(starPoints(cols, 8, 6), ink.star);
  const ground = `<rect y="${FEET}" width="${cols}" height="1" fill="${ink.ground}"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${cols} ${SVG_ROWS}" shape-rendering="crispEdges">` +
    `${opts.background ?? ""}${stars}${ground}${parts.join("")}</svg>`;
  return { svg, overflow: crew.rows.length - drawn, spots };
}

/** The lead: its critter at the left in its state's pose, and its state beside the head as a bubble, a baton, an hourglass or Zs. */
function leadSvg(lead: Lead, opts: SceneOpts, body: number, ink: SceneInk): string {
  const k = SCALE[modelFamily(lead.model)] * LEAD_SCALE;
  const cx = LEAD_X + 3.5 * k;
  const ax = Math.round(LEAD_X + 7 * k) + 1;
  const ay = Math.round(FEET - CRITTER_ROWS * k);
  const head = headwearSvg(opts.headwear);
  const at = (pose: Pose): string => figure({ body, k, cx, blink: 3.5, pose, head });
  switch (lead.state) {
    case "working":
      return `<g>${at(poseOf("editing", body, ink))}<g class="bubble">${bubble(ax, ay, 0, ink)}</g>${bob("0.9s")}</g>`;
    case "directing":
      return `<g>${at(poseOf("directing", body, ink))}${bob("1.4s")}</g>`;
    case "waiting":
      return `<g>${at({ ...poseOf("thinking", body, ink), eyes: "glance", prop: "" })}${hourglass(ax, ay)}</g>`;
    case "resting":
      return `<g>${at({ ...poseOf("thinking", body, ink), eyes: "shut", prop: "" })}${zs(ax, ay, ink)}</g>`;
  }
}

/** A crew member at `x`: its pose, a "…" bubble while it thinks, the amber "!" past the token warning, dimmed once finished. */
function rowSvg(row: Row, x: number, k: number, slot: number, ink: SceneInk, colours: Palette): string {
  const activity = activityOf(row);
  const base = colours[modelFamily(row.model)];
  const body = activity === "failed" ? mix(base, MODEL_BODY.unknown, 0.6) : base;
  const cx = x + 3.5 * k;
  const bx = Math.round(cx - 3);
  const by = Math.round(FEET - CRITTER_ROWS * k) - 5;
  const working = row.state === "working";
  const pose = poseOf(activity, body, ink);
  // A warning takes the place of the activity's prop, so an over row keeps its arms and eyes but shows no prop.
  const indicator = row.over ? warning(bx, by, ink) : working && activity === "thinking" ? bubble(bx, by, slot, ink) : "";
  const shown = row.over ? { ...pose, prop: "" } : pose;
  return `<g${working ? "" : ` opacity=".55"`}>${figure({ body, k, cx, blink: 3.5 + (slot % 4) * 0.7, pose: shown, head: "" })}${indicator}` +
    `${working ? bob("0.9s", slot * 0.17) : ""}</g>`;
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

/** A small cream hourglass beside the head, pulsing: the lead waits for its crew. */
function hourglass(x: number, y: number): string {
  return `<g class="hourglass" transform="translate(${x} ${y})">${pixels(HOURGLASS, 0, 0, { "#": hex(CREAM) })}` +
    `<animate attributeName="opacity" values=".35;1;.35" dur="1.6s" repeatCount="indefinite"/></g>`;
}

/** The resting lead's three Zs: each rises from beside its head, fading in and out, a second apart. */
function zs(x: number, y: number, ink: SceneInk): string {
  return [0.6, 0.8, 1].map((s, n) => `<g class="z" opacity="0"><g transform="translate(${x} ${y}) scale(${s})">${pixels(ZED, 0, 0, { "#": ink.star })}</g>` +
    `<animate attributeName="opacity" values="0;1;0" dur="3s" begin="${n}s" repeatCount="indefinite"/>` +
    `<animateTransform attributeName="transform" type="translate" values="0 0;3 -6" dur="3s" begin="${n}s" repeatCount="indefinite"/></g>`).join("");
}

/** A one-pixel discrete bob up and back on `dur`, starting `begin` seconds in. */
function bob(dur: string, begin = 0): string {
  return `<animateTransform attributeName="transform" type="translate" values="0 0;0 -1" calcMode="discrete" ` +
    `dur="${dur}" begin="${begin.toFixed(2)}s" repeatCount="indefinite"/>`;
}
