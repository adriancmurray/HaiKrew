/**
 * A Claude bot in smooth SVG: a rounded block body with an expressive face, arms, legs and a ground shadow. Pure:
 * bot() returns an SVG fragment and anchor points, and equal options give an equal string.
 */
import type { Uid } from "./common.ts";
import { darken, idMaker, lighten, mix, rand } from "./common.ts";

/** Front-on, or in profile (which uses facing and the side arms). */
export type View = "front" | "side";
/** How the legs stand: still, walking, tapping one foot, or sitting. */
export type Legs = "stand" | "walk" | "tap" | "sit";
/** The bot's expression. */
export type Mood = "neutral" | "happy" | "focused" | "reading" | "searching" | "thinking" | "waiting" | "sleepy" | "failed" | "alarmed" | "proud";
/** An arm pose. "wave" lifts the arm as "up" does, then swings it. */
export type ArmPose = "down" | "up" | "forward" | "type" | "hold" | "chin" | "wave";
type PoseKey = Exclude<ArmPose, "wave">;
type Pt = [number, number];
/** A point in scene pixels where a prop can attach. */
export interface Anchor { x: number; y: number }

/** Options for bot(). */
export interface BotOptions {
  /** Centre x. */
  x: number;
  /** y of the feet. */
  ground: number;
  /** Overall height, legs included. */
  h: number;
  color: string;
  view?: View;
  /** Side view only: 1 faces right, -1 faces left. */
  facing?: number;
  legs?: Legs;
  mood?: Mood;
  arms?: { near?: ArmPose; far?: ArmPose };
  /** Seconds for one up-and-down bob; 0 or absent keeps the bot still. */
  bob?: number;
  grey?: boolean;
  /** SVG drawn at the near hand, its +x along the forearm at rest. */
  nearProp?: string;
  /** Prefix for the ids this drawing makes; give each bot on one page its own. */
  idPrefix?: string;
}

/** What bot() returns: the SVG fragment and the points that props and acts attach to. */
export interface BotResult {
  svg: string;
  anchors: { hand: Anchor; farHand: Anchor; head: Anchor; face: Anchor; lap: Anchor; width: number };
}

type Mouth = "smile" | "wide" | "big" | "flat" | "side" | "o" | "wavy";
type Eye = "pill" | "arc" | "upArc" | "closed" | "x" | "circle";
/** The look of one mood: eye style, brow lift or tilt, mouth shape, and extras such as blink, glance or breathing. */
interface Recipe {
  eye: Eye;
  mouth: Mouth;
  pill?: number;
  lift?: number;
  lid?: boolean;
  squint?: boolean;
  raise?: "near" | "all";
  up?: boolean;
  blink?: boolean;
  glance?: boolean;
  breathe?: boolean;
  sweat?: boolean;
}

const INK = "#231a2e";
const GREY = "#8a8f9c";
const SWEAT = "#8fc3e8";

const MOOD: Record<Mood, Recipe> = {
  neutral: { eye: "pill", mouth: "smile", blink: true },
  happy: { eye: "arc", mouth: "wide" },
  focused: { eye: "pill", pill: 0.7, lift: 0.03, mouth: "smile", blink: true },
  reading: { eye: "pill", lid: true, mouth: "o" },
  searching: { eye: "pill", squint: true, raise: "near", mouth: "flat", blink: true },
  thinking: { eye: "pill", up: true, raise: "near", mouth: "side", blink: true },
  waiting: { eye: "pill", glance: true, mouth: "flat", blink: true },
  sleepy: { eye: "closed", mouth: "o", breathe: true },
  failed: { eye: "x", mouth: "wavy", sweat: true },
  alarmed: { eye: "circle", raise: "all", mouth: "o" },
  proud: { eye: "upArc", mouth: "big" },
};

/**
 * Arm targets per pose, in multiples of h. The hand is [x, y] from the body centre (x, scaled by the arm's side)
 * and the body top (y); the elbow, when given, is measured the same way. Elbows hang at 80% of body height in side view.
 */
const FRONT: Record<PoseKey, { hand: Pt; elbow?: Pt }> = {
  down: { hand: [0.64, 0.82] },
  up: { hand: [0.78, -0.1] },
  forward: { hand: [0.36, 0.59] },
  type: { hand: [0.44, 0.59] },
  hold: { hand: [0.16, 0.53] },
  chin: { hand: [0.2, 0.5], elbow: [0.72, 0.66] },
};
const SIDE: Record<PoseKey, { hand: Pt; elbow: Pt }> = {
  down: { elbow: [0.08, 0.704], hand: [0.08, 0.93] },
  up: { elbow: [0.0, 0.3], hand: [0.14, -0.1] },
  forward: { elbow: [0.08, 0.704], hand: [0.46, 0.56] },
  type: { elbow: [0.08, 0.704], hand: [0.48, 0.59] },
  hold: { elbow: [0.08, 0.704], hand: [0.5, 0.56] },
  chin: { elbow: [0.08, 0.704], hand: [0.22, 0.5] },
};

interface Geometry {
  cx: number;
  G: number;
  h: number;
  side: boolean;
  f: number;
  sit: boolean;
  bw: number;
  bh: number;
  B: number;
  T: number;
  eyes: { x: number; near: boolean }[];
  legs: Legs;
  base: string;
  grey: boolean;
  lw: number;
  SY: number;
  eyeY: number;
  mouthY: number;
  mood: Recipe;
  arms: { near: ArmPose; far: ArmPose };
  bob: number;
  nearProp: string;
  uid: Uid;
}

/** Rounds a number for compact SVG output. */
const n = (v: number): number => +v.toFixed(2);
/** Formats an x, y pair for an SVG attribute or path command. */
const P = (x: number, y: number): string => `${n(x)} ${n(y)}`;
/** A stroked path with round caps and joins; `inner` holds optional SMIL animation. */
const pathEl = (d: string, w: number, col: string, inner = ""): string =>
  `<path d="${d}" fill="none" stroke="${col}" stroke-width="${n(w)}" stroke-linecap="round" stroke-linejoin="round">${inner}</path>`;

/** Derives every measurement from the overall height h and the stance. */
function geometry(o: BotOptions): Geometry {
  const { x: cx, ground: G, h } = o;
  const side = o.view === "side";
  const f = side && o.facing === -1 ? -1 : 1;
  const sit = o.legs === "sit";
  const legGap = sit ? 0 : h * 0.12;
  const bh = h * 0.88, bw = h * (side ? 0.85 : 1.3);
  const B = G - legGap, T = B - bh;
  const eyes = side
    ? [{ x: cx + f * h * 0.22, near: true }]
    : [{ x: cx - h * 0.26, near: false }, { x: cx + h * 0.26, near: true }];
  const grey = !!o.grey;
  return {
    cx, G, h, side, f, sit, bw, bh, B, T, eyes,
    legs: o.legs ?? "stand",
    base: grey ? mix(o.color, GREY, 0.6) : o.color,
    grey,
    lw: bw * (side ? 0.18 : 0.14),
    SY: T + bh * 0.58,
    eyeY: T + bh * 0.4,
    mouthY: T + bh * 0.66,
    mood: MOOD[o.mood ?? "neutral"],
    arms: { near: o.arms?.near ?? "down", far: o.arms?.far ?? "down" },
    bob: o.bob ?? 0,
    nearProp: o.nearProp ?? "",
    uid: idMaker(o.idPrefix ?? "hk"),
  };
}

/** SMIL blink: the eye squashes to 10% height for 0.12 s every 3 to 6 s, timed by the seed. */
function blinkAnim(seed: number): string {
  const D = 3 + 3 * rand(seed), q = (v: number): number => +v.toFixed(3);
  return `<animateTransform attributeName="transform" type="scale" values="1 1;1 1;1 0.1;1 1" keyTimes="0;${q((D - 0.12) / D)};${q((D - 0.06) / D)};1" dur="${q(D)}s" repeatCount="indefinite"/>`;
}

/** One eye in the mood's style, centred on the eye x and the eye line. */
function eyeOf(g: Geometry, e: { x: number; near: boolean }): string {
  const { h, f, mood: m } = g;
  const ex = e.x + (m.up ? h * 0.04 * f : 0);
  const ey = g.eyeY - (m.up ? h * 0.04 : 0) + (m.lid ? 1.5 : 0);
  const p = (x: number, y: number): string => P(ex + x * h, ey + y * h);
  const w = h * 0.03;
  switch (m.eye) {
    case "arc": return pathEl(`M${p(-0.06, 0.03)} Q${p(0, -0.11)} ${p(0.06, 0.03)}`, w, INK);
    case "upArc": return pathEl(`M${p(-0.07, 0.035)} Q${p(0, -0.08)} ${p(0.07, 0.035)}`, w, INK);
    case "closed": return pathEl(`M${p(-0.06, 0)} Q${p(0, 0.05)} ${p(0.06, 0)}`, w, INK);
    case "x": return pathEl(`M${p(-0.045, -0.045)} L${p(0.045, 0.045)} M${p(0.045, -0.045)} L${p(-0.045, 0.045)}`, w, INK);
    case "circle": return `<circle cx="${n(ex)}" cy="${n(ey)}" r="${n(h * 0.06)}" fill="${INK}"/>`;
    default: {
      const eh = h * 0.15, ew = h * 0.075;
      const hh = eh * (m.pill ?? (m.squint && !e.near ? 0.25 : 1));
      const blink = m.blink ? blinkAnim(g.cx) : "";
      const lid = m.lid ? `<rect x="${n(-ew * 0.8)}" y="${n(-eh / 2 - 2)}" width="${n(ew * 1.6)}" height="${n(eh / 2 + 2)}" fill="${g.base}"/>` : "";
      return `<g transform="translate(${P(ex, ey)})"><rect x="${n(-ew / 2)}" y="${n(-hh / 2)}" width="${n(ew)}" height="${n(hh)}" rx="${n(ew / 2)}" fill="${INK}">${blink}</rect>${lid}</g>`;
    }
  }
}

/** A short flat brow above an eye, lifted by the mood (never angled inward, so no moods look upset). */
function browOf(g: Geometry, e: { x: number; near: boolean }): string {
  const { h, eyeY, mood: m } = g;
  const lift = m.raise === "all" ? 0.1 : m.raise === "near" && e.near ? 0.07 : m.lift ?? 0;
  const by = eyeY - h * (0.13 + lift);
  return pathEl(`M${P(e.x - h * 0.06, by)} L${P(e.x + h * 0.06, by)}`, h * 0.035, INK);
}

/** The mouth for the mood, below the eyes; "side" pushes it toward one side. */
function mouthOf(g: Geometry): string {
  const { h, cx, f, side, mouthY: my, mood: m } = g;
  const mx = (side ? cx + f * h * 0.22 : cx) + (m.mouth === "side" ? f * h * 0.07 : 0);
  const abs = (x: number, y: number): string => P(mx + x * h, my + y * h);
  const rel = (x: number, y: number): string => P(x * h, y * h);
  const w = h * 0.025;
  switch (m.mouth) {
    case "wide": return pathEl(`M${abs(-0.12, 0)} Q${abs(0, 0.14)} ${abs(0.12, 0)}`, w, INK);
    case "big": return pathEl(`M${abs(-0.14, 0)} Q${abs(0, 0.18)} ${abs(0.14, 0)}`, w, INK);
    case "flat": return pathEl(`M${abs(-0.05, 0)} L${abs(0.05, 0)}`, w, INK);
    case "side": return pathEl(`M${abs(-0.04, 0)} L${abs(0.04, -0.012)}`, w, INK);
    case "o": return `<ellipse cx="${n(mx)}" cy="${n(my)}" rx="${n(h * 0.035)}" ry="${n(h * 0.045)}" fill="${INK}"/>`;
    case "wavy": return pathEl(`M${abs(-0.08, 0)} q${rel(0.02, -0.025)} ${rel(0.04, 0)} t${rel(0.04, 0)} t${rel(0.04, 0)}`, w, INK);
    default: return pathEl(`M${abs(-0.05, 0)} Q${abs(0, 0.035)} ${abs(0.05, 0)}`, w, INK);
  }
}

/** Eyes (with glance), brows, mouth and sweat drop for the mood. */
function faceArt(g: Geometry): string {
  const { h, cx, bw, T, f, eyes, mood: m } = g;
  const eyeSvg = eyes.map((e) => eyeOf(g, e)).join("");
  const glance = m.glance
    ? `<g><animateTransform attributeName="transform" type="translate" values="0 0;${n(-h * 0.05)} 0;0 0;${n(h * 0.05)} 0;0 0" keyTimes="0;0.25;0.5;0.75;1" dur="2.4s" repeatCount="indefinite"/>${eyeSvg}</g>`
    : eyeSvg;
  const brows = eyes.map((e) => browOf(g, e)).join("");
  let sweat = "";
  if (m.sweat) {
    const sx = cx + f * (bw / 2 + h * 0.06), sy = T + h * 0.1, r = h * 0.04;
    sweat = `<path d="M${P(sx, sy - 2 * r)} Q${P(sx + r, sy)} ${P(sx, sy + r)} Q${P(sx - r, sy)} ${P(sx, sy - 2 * r)}Z" fill="${SWEAT}"/>`;
  }
  return glance + brows + mouthOf(g) + sweat;
}

/** The body block: gradient, base band, top highlight, side plate, face and outline. */
function blockArt(g: Geometry): string {
  const { cx, T, bw, bh, h, side, f, base } = g;
  const gid = g.uid("bg"), cid = g.uid("bc");
  const box = `x="${n(cx - bw / 2)}" y="${n(T)}" width="${n(bw)}" height="${n(bh)}" rx="${n(h * 0.16)}"`;
  const plate = side
    ? `<rect x="${n(cx + f * h * 0.12 - h * 0.18)}" y="${n(T + bh * 0.14)}" width="${n(h * 0.36)}" height="${n(bh * 0.64)}" rx="${n(h * 0.12)}" fill="${lighten(base, 0.14)}"/>`
    : "";
  return `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${lighten(base, 0.14)}"/><stop offset="0.55" stop-color="${base}"/><stop offset="1" stop-color="${darken(base, 0.12)}"/></linearGradient><clipPath id="${cid}"><rect ${box}/></clipPath></defs>` +
    `<rect ${box} fill="url(#${gid})"/>` +
    `<g clip-path="url(#${cid})"><rect x="${n(cx - bw / 2)}" y="${n(T + bh * 0.8)}" width="${n(bw)}" height="${n(bh * 0.2)}" fill="${darken(base, 0.2)}"/>` +
    `<rect x="${n(cx - bw * 0.34)}" y="${n(T + bh * 0.07)}" width="${n(bw * 0.68)}" height="${n(bh * 0.1)}" rx="${n(bh * 0.05)}" fill="#ffffff" opacity="0.18"/></g>` +
    plate + faceArt(g) +
    `<rect ${box} fill="none" stroke="${darken(base, 0.45)}" stroke-opacity="0.55" stroke-width="${n(h * 0.03)}"/>`;
}

/** Wraps the body so it scales 1 to 1.03 in Y about its bottom edge (sleepy breathing). */
function breathe(cx: number, B: number, inner: string): string {
  return `<g transform="translate(${P(cx, B)})"><g><animateTransform attributeName="transform" type="scale" values="1 1;1 1.03;1 1" dur="3s" repeatCount="indefinite"/><g transform="translate(${P(-cx, -B)})">${inner}</g></g></g>`;
}

/**
 * One leg: a short, sturdy rounded rectangle whose top hides under the body. Walk and tap lift the whole
 * limb with SMIL, so the top stays hidden. Near legs are lighter than far ones.
 */
function legOf(g: Geometry, near: boolean): string {
  const { cx, G, h, side, f, lw, B, legs } = g;
  const col = darken(g.base, near ? 0.2 : 0.32);
  const rx = h * 0.04, d = near ? 1 : -1;
  const box = (x: number, y: number, w: number, hh: number): string => `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(hh)}" rx="${n(rx)}" fill="${col}"/>`;
  const span = (x0: number, x1: number, y: number, hh: number): string => box(Math.min(x0, x1), y, Math.abs(x1 - x0), hh);
  if (g.sit) {
    if (!side) return span(cx + d * h * 0.5, cx + d * h * 0.72, G - lw, lw);
    return span(cx + f * h * 0.1, cx + f * h * 0.6, near ? G - lw : G - lw - h * 0.05, lw);
  }
  const hx = side ? cx + f * h * (near ? 0.1 : -0.1) : cx + d * h * 0.27;
  const top = B - h * 0.08;
  let parts = box(hx - lw / 2, top, lw, G - top);
  if (side) parts += span(hx - f * lw / 2, hx + f * h * 0.1, G - h * 0.05, h * 0.05);
  const lift = (begin: number, dur: number, dy: number): string =>
    `<animateTransform attributeName="transform" type="translate" values="0 0;0 ${n(-dy)};0 0" dur="${dur}s" begin="${begin}s" repeatCount="indefinite"/>`;
  if (legs === "walk" && side) {
    const sw = near ? -24 * f : 24 * f, at = P(hx, B);
    return `<g><animateTransform attributeName="transform" type="rotate" values="${sw} ${at};${-sw} ${at};${sw} ${at}" dur="0.6s" repeatCount="indefinite"/>${parts}</g>`;
  }
  if (legs === "walk") return `<g>${lift(near ? 0 : -0.3, 0.6, h * 0.07)}${parts}</g>`;
  if (legs === "tap" && near) return `<g>${lift(0, 0.5, h * 0.07)}${parts}</g>`;
  return `<g>${parts}</g>`;
}

/** One arm: a rounded stroke from the shoulder through an optional elbow to the hand. */
function armOf(g: Geometry, near: boolean, pose: ArmPose): { svg: string; hand: Anchor } {
  const { cx, h, side, f, bw, bh, SY, T } = g;
  const p = (side ? SIDE : FRONT)[pose === "wave" ? "up" : pose];
  const dir = side ? f : near ? 1 : -1;
  const at = (q: Pt): Pt => [cx + dir * q[0] * h, T + q[1] * h];
  const S: Pt = side ? [cx + f * (bw / 2 - bw * 0.35), T + bh * 0.6] : [cx + dir * 0.6 * h, SY];
  const H = at(p.hand);
  const E = p.elbow ? at(p.elbow) : null;
  const hand = { x: H[0], y: H[1] };
  const sp = P(S[0], S[1]);
  let anim = "";
  if (pose === "wave") anim = `<animateTransform attributeName="transform" type="rotate" values="-25 ${sp};25 ${sp};-25 ${sp}" dur="1.2s" repeatCount="indefinite"/>`;
  if (pose === "type") anim = `<animateTransform attributeName="transform" type="translate" values="0 0;0 ${n(-h * 0.04)};0 0" dur="0.5s" begin="${near ? 0 : -0.25}s" repeatCount="indefinite"/>`;
  const col = side ? darken(g.base, near ? 0.3 : 0.42) : darken(g.base, near ? 0.12 : 0.28);
  const d = `M${sp} ${E ? `L${P(E[0], E[1])} ` : ""}L${P(H[0], H[1])}`;
  // Side-view hands are round and a shade lighter than the arm so they read as hands.
  const handDot = side ? `<circle cx="${n(H[0])}" cy="${n(H[1])}" r="${n(h * 0.075)}" fill="${lighten(col, 0.15)}"/>` : "";
  // The prop sits inside the arm group so every arm animation carries it with the hand; it aims along the forearm.
  const from = E ?? S;
  const aim = Math.atan2(H[1] - from[1], H[0] - from[0]) * 180 / Math.PI;
  const prop = near && g.nearProp ? `<g transform="translate(${P(H[0], H[1])}) rotate(${n(aim)})">${g.nearProp}</g>` : "";
  return { svg: `<g>${anim}${pathEl(d, h * 0.1, col)}${handDot}${prop}</g>`, hand };
}

/** A soft radial ground shadow, wider while sitting. */
function shadowArt(g: Geometry): string {
  const { cx, G, h, side, sit } = g;
  const id = g.uid("sh");
  const rx = h * (side ? 0.5 : 0.62) * (sit ? 1.4 : 1);
  return `<defs><radialGradient id="${id}"><stop offset="0" stop-color="#000" stop-opacity="0.3"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient></defs>` +
    `<ellipse cx="${n(cx)}" cy="${n(G + h * 0.01)}" rx="${n(rx)}" ry="${n(h * 0.06)}" fill="url(#${id})"/>`;
}

/**
 * Draws a Claude bot. x is the centre, ground the y of the feet, h the overall height including legs.
 * Returns { svg, anchors } where anchors hold hand, farHand, head, face, lap (points) and width.
 */
export function bot(o: BotOptions): BotResult {
  const g = geometry(o);
  const { h, cx, T, bob } = g;
  const near = armOf(g, true, g.arms.near), far = armOf(g, false, g.arms.far);
  const block = g.mood.breathe ? breathe(cx, g.B, blockArt(g)) : blockArt(g);
  const drawn = [legOf(g, false), legOf(g, true)];
  if (g.side) drawn.push(far.svg, block, near.svg);
  else drawn.push(block, far.svg, near.svg);
  const bobAnim = bob > 0
    ? `<animateTransform attributeName="transform" type="translate" values="0 0;0 ${n(-h * 0.03)};0 0" keyTimes="0;0.5;1" calcMode="spline" keySplines="0.45 0 0.55 1;0.45 0 0.55 1" dur="${bob}s" repeatCount="indefinite"/>`
    : "";
  const svg = shadowArt(g) + `<g${g.grey ? ' opacity="0.65"' : ""}><g>${bobAnim}${drawn.join("")}</g></g>`;
  const lapX = g.side ? cx + g.f * (g.bw / 2 + h * 0.1) : cx;
  return {
    svg,
    anchors: {
      hand: near.hand,
      farHand: far.hand,
      head: { x: cx, y: T },
      face: { x: g.side ? cx + g.f * h * 0.12 : cx, y: g.eyeY },
      lap: { x: lapX, y: T + h * 0.6 },
      width: g.bw,
    },
  };
}
