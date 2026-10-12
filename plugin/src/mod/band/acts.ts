/**
 * Activity scenes for the band: each draws one bot with its props and looping SMIL animation, and reports the
 * horizontal room it uses. Pure: equal options give an equal string.
 */
import type { Anchor, BotOptions, BotResult } from "./bot.ts";
import { bot as drawBot } from "./bot.ts";
import type { Uid } from "./common.ts";
import { darken, idMaker } from "./common.ts";
import type { Headwear } from "./props.ts";
import { anim, el, gauge, glowDef, headwearArt, magnifier, mug, scrollLines, star, xform } from "./props.ts";

/** The headwear kinds, re-exported for callers that pick one. */
export type { Headwear } from "./props.ts";

/** The activity a bot can be drawn doing. "editing" and "running" are aliases of "typing" and "terminal". */
export type ActName ="typing" | "editing" | "terminal" | "running" | "searching" | "reading" | "thinking" | "directing" |
  "waiting" | "resting" | "done" | "failed" | "alarmed";
/** Every act name, the aliases "editing" (typing) and "running" (terminal) included. */
export const ACT_NAMES: ActName[] = ["typing", "editing", "terminal", "running", "searching", "reading", "thinking",
  "directing", "waiting", "resting", "done", "failed", "alarmed"];

const CODE = ["#7fb4ff", "#ffb86b", "#9be38f", "#d4a6ff", "#ffe27a"];
const GREEN = ["#3fb950", "#7ee787", "#3fb950", "#56d364", "#7ee787"];
const PAPER = "#fbf7ee";

/** Tracks the horizontal extent of everything a scene draws, so the scene can report its width and where it starts. */
interface Span {
  add(a: number, b?: number): void;
  width(): number;
  left(): number;
}
/** What a scene draws with: the bot's frame, the headwear, the act's id maker and the room tracker. */
interface Ctx {
  x: number;
  ground: number;
  h: number;
  k: number;
  color: string;
  headwear: Headwear;
  uid: Uid;
  prefix: string;
  sp: Span;
}
type SceneBot = Omit<BotOptions, "x" | "ground" | "h" | "color" | "idPrefix">;
type Scene = (c: Ctx) => string;

const span = (): Span => {
  let lo = Infinity, hi = -Infinity;
  return { add(a: number, b = a) { lo = Math.min(lo, a); hi = Math.max(hi, b); }, width: () => hi - lo, left: () => lo };
};

/**
 * Draws a bot at the scene's centre and records the span its body takes. The tag keeps this bot's ids apart from
 * the scene's and from any other bot in the same act.
 */
const bot = (c: Ctx, o: SceneBot, tag = "b"): BotResult => {
  const b = drawBot({ ...o, x: c.x, ground: c.ground, h: c.h, color: c.color, idPrefix: `${c.prefix}-${tag}` });
  c.sp.add(c.x - b.anchors.width / 2, c.x + b.anchors.width / 2);
  return b;
};

/** The scene's headwear, sat on this bot's head. face is 1 or -1 in side view and 0 in front view. */
const headgear = (c: Ctx, head: Anchor, face = 0): string => headwearArt(c.headwear, head, c.h, face, c.uid);

/** Side view: a bot typing at a laptop on a desk, its screen toward the bot with code scrolling on it. */
const typing: Scene = (c) => {
  const { x, ground, h, k, sp } = c;
  const b = bot(c, { view: "side", mood: "focused", arms: { near: "type", far: "type" }, legs: "sit" });
  const { hand, lap, face, head } = b.anchors;
  const u = 2 * k;
  const top = hand.y, base = top - 2.2 * u, hinge = hand.x + 14 * u, keysL = hand.x - 4 * u;
  const deskL = keysL, deskR = hinge + 6 * k, stoolY = lap.y + 2 * k, gid = c.uid("gl");
  const box = { x: -12 * u, y: -10 * u, w: 11 * u, h: 9 * u };
  sp.add(x - 0.3 * h, deskR);
  const stool = el("rect", { x: x - 0.3 * h, y: stoolY, width: 0.6 * h, height: 2.4 * k, rx: 1.2 * k, fill: "#5d6172" }) +
    el("path", { d: `M${x - 0.2 * h} ${stoolY + 2.4 * k}L${x - 0.26 * h} ${ground}M${x + 0.2 * h} ${stoolY + 2.4 * k}L${x + 0.26 * h} ${ground}`, stroke: "#5d6172", "stroke-width": 1.6 * k, fill: "none" });
  const desk = el("rect", { x: deskL, y: top, width: deskR - deskL, height: 2.5 * k, rx: k, fill: "#a88466" }) +
    el("path", { d: `M${deskR - 3 * k} ${top + 2.5 * k}V${ground}M${deskL + 3 * k} ${top + 2.5 * k}V${ground}`, stroke: "#7a5c44", "stroke-width": 2 * k, fill: "none" });
  const keys = el("rect", { x: keysL, y: base, width: hinge - keysL, height: 2.2 * u, rx: 0.4 * u, fill: "#c9ccd6" });
  const screen = el("g", { transform: `translate(${hinge} ${base}) skewX(-12)` },
    el("rect", { x: -13 * u, y: -11 * u, width: 13 * u, height: 11 * u, rx: 0.5 * u, fill: "#2a2f3d" }) +
    el("rect", { x: box.x, y: box.y, width: box.w, height: box.h, fill: "#0f1a2e" }) +
    scrollLines(box, CODE, 2.2 * u, 2.4, c.uid));
  const glow = glowDef(gid, "#9fd3ff", 0.25) +
    el("circle", { cx: face.x + 0.1 * h, cy: face.y, r: 0.25 * h, fill: `url(#${gid})` });
  return stool + desk + keys + screen + b.svg + glow + headgear(c, head, 1);
};

/** Side view: a bot standing at a terminal monitor; a green check pops above the screen every 5 s. */
const terminal: Scene = (c) => {
  const { x, ground, h, k, sp } = c;
  const b = bot(c, { view: "side", mood: "focused", arms: { near: "type", far: "down" }, legs: "stand" });
  const sw = 0.9 * h, sh = 0.55 * h, sl = x + 0.6 * h, sb = ground - 0.4 * h, st = sb - sh, mx = sl + sw / 2;
  const inner = { x: sl + 1.2 * k, y: st + 1.2 * k, w: sw - 2.4 * k, h: sh - 2.4 * k };
  sp.add(mx - 0.25 * h, sl + sw);
  const stand = el("rect", { x: mx - k, y: sb, width: 2 * k, height: ground - 1.6 * k - sb, fill: "#4a4f5c" }) +
    el("rect", { x: mx - 0.25 * h, y: ground - 1.6 * k, width: 0.5 * h, height: 1.6 * k, rx: 0.8 * k, fill: "#4a4f5c" });
  const frame = el("rect", { x: sl, y: st, width: sw, height: sh, rx: 1.2 * k, fill: "#2b2f3a" }) +
    el("rect", { x: inner.x, y: inner.y, width: inner.w, height: inner.h, fill: "#0b0f14" }) +
    scrollLines(inner, GREEN, 2.4 * k, 3, c.uid);
  const cursor = el("rect", { x: inner.x + 1.5 * k, y: inner.y + inner.h - 3 * k, width: 1.8 * k, height: 2.2 * k, fill: "#7ee787" },
    anim("opacity", "1;0;1", 1, "0;0.5;1"));
  const check = el("g", { transform: `translate(${mx} ${st - 4 * k})` }, el("g", {},
    xform("scale", "0;1.2;1;1;0", 5, "0;0.06;0.1;0.9;1") +
    el("circle", { r: 3.2 * k, fill: "#3fb950" }) +
    el("path", { d: `M${-1.5 * k} 0L${-0.4 * k} ${1.2 * k}L${1.6 * k} ${-1.2 * k}`, fill: "none", stroke: "#ffffff", "stroke-width": 1.2 * k, "stroke-linecap": "round" })));
  return stand + frame + cursor + b.svg + check + headgear(c, b.anchors.head, 1);
};

/** Side view: a bot walking slowly back and forth with a magnifying glass; it turns at each end. */
const searching: Scene = (c) => {
  const { x, k, h, sp } = c;
  const walk = 30, dur = 8;
  const opts: SceneBot = { view: "side", mood: "searching", arms: { near: "forward", far: "forward" }, legs: "walk" };
  // Each facing copy carries its own magnifier and its own id prefix; the copy shown is the one facing the way it moves.
  const copy = (facing: number, move: string, show: string): string => {
    const b = bot(c, { ...opts, facing, nearProp: magnifier(k, c.uid) }, facing > 0 ? "r" : "l");
    return el("g", { opacity: show.split(";")[0] }, xform("translate", move, dur, "0;0.5;1") +
      anim("opacity", show, dur, "0;0.5", { calcMode: "discrete" }) +
      b.svg + headgear(c, b.anchors.head, facing));
  };
  const half = 0.65 * h + 15 * k;
  sp.add(x - half, x + walk + half);
  return copy(1, `0 0;${walk} 0;${walk} 0`, "1;0") + copy(-1, `${walk} 0;${walk} 0;0 0`, "0;1");
};

/** Front view: a bot reading an open book on its lap; the right-hand page turns over every 3 s. */
const reading: Scene = (c) => {
  const { h, k, color, sp } = c;
  const b = bot(c, { view: "front", mood: "reading", arms: { near: "hold", far: "hold" }, legs: "sit" });
  const { lap, face, head } = b.anchors;
  const pw = 0.3 * b.anchors.width, ph = 0.3 * h, sx = lap.x, top = face.y + 0.08 * h;
  sp.add(sx - pw - 1.2 * k, sx + pw + 1.2 * k);
  const lines = (x0: number): string => [0, 1, 2, 3].map((i) => el("rect", { x: x0 + 2 * k, y: top + (3 + 3 * i) * k,
    width: (pw - 4 * k) * (i === 3 ? 0.5 : 1), height: 0.9 * k, fill: "#cfc7b6" })).join("");
  const cover = el("rect", { x: sx - pw - 1.2 * k, y: top - 1.2 * k, width: 2 * pw + 2.4 * k, height: ph + 2.4 * k, rx: 1.5 * k, fill: darken(color, 0.3) });
  const leftPage = el("rect", { x: sx - pw, y: top, width: pw, height: ph, fill: PAPER }) + lines(sx - pw);
  const rightPage = el("rect", { x: sx, y: top, width: pw, height: ph, fill: PAPER }) + lines(sx);
  const flip = el("g", { transform: `translate(${sx} 0)` }, el("g", {},
    xform("scale", "1 1;1 1;-1 1;-1 1;1 1", 3, "0;0.1;0.4;0.9;0.9001") +
    anim("opacity", "1;1;0;0;1", 3, "0;0.4;0.5;0.9;0.9001") +
    el("rect", { x: 0, y: top, width: pw, height: ph, fill: PAPER }) + lines(0)));
  return b.svg + cover + leftPage + rightPage + flip + headgear(c, head);
};

/** Front view: a thinking bot; three puffs lead up to a cloud where a bulb goes from grey to yellow every 4 s. */
const thinking: Scene = (c) => {
  const { h, k, sp } = c;
  const b = bot(c, { view: "front", mood: "thinking", arms: { near: "chin", far: "down" }, legs: "stand" });
  const { head } = b.anchors;
  const R = 0.3 * h, cx = head.x + 0.85 * h, cy = head.y - 0.25 * h, gid = c.uid("bulb");
  const from = { x: head.x + 0.4 * h, y: head.y + 0.1 * h }, by = cy - 0.1 * R;
  sp.add(from.x - 0.1 * h, cx + 1.1 * R);
  const puffSpec: [number, number][] = [[0.3, 0.05], [0.6, 0.07], [0.82, 0.09]];
  const puffs = puffSpec.map(([t, r]) =>
    el("circle", { cx: from.x + (cx - from.x) * t, cy: from.y + (cy - from.y) * t, r: r * h, fill: "#f4f7fb", stroke: "#b8c3d6", "stroke-width": 0.6 * k })).join("");
  const lobeSpec: [number, number, number][] = [[-0.6, 0.1, 0.55], [-0.15, -0.2, 0.7], [0.4, -0.15, 0.6], [0.7, 0.15, 0.45], [0.05, 0.25, 0.6]];
  const lobes = lobeSpec.map(([dx, dy, s]) => ({ x: cx + dx * R, y: cy + dy * R, r: s * R }));
  const cloud = lobes.map((l) => el("circle", { cx: l.x, cy: l.y, r: l.r + 0.6 * k, fill: "#b8c3d6" })).join("") +
    lobes.map((l) => el("circle", { cx: l.x, cy: l.y, r: l.r, fill: "#f4f7fb" })).join("");
  const glow = glowDef(gid, "#ffe36b", 0.9) +
    el("circle", { cx, cy: by, r: 1.1 * R, fill: `url(#${gid})` }, anim("opacity", "0;0;1;0.6;0", 4, "0;0.6;0.65;0.9;1"));
  const bulb = el("rect", { x: cx - 0.18 * R, y: cy + 0.3 * R, width: 0.36 * R, height: 0.22 * R, rx: 0.05 * R, fill: "#6b7385" }) +
    el("circle", { cx, cy: by, r: 0.38 * R, fill: "#9aa3b2", stroke: "#6b7385", "stroke-width": 0.5 * k },
      anim("fill", "#9aa3b2;#9aa3b2;#ffd84d;#ffd84d;#9aa3b2", 4, "0;0.6;0.65;0.9;1"));
  return b.svg + puffs + cloud + glow + bulb + headgear(c, head);
};

/** Front view: a conductor with a baton in the waving hand; three music notes float up in turn. */
const directing: Scene = (c) => {
  const { h, k, color, sp } = c;
  const baton = el("line", { x1: 0, y1: 0, x2: 14 * k, y2: 0, stroke: "#f3e9d2", "stroke-width": 1.4 * k, "stroke-linecap": "round" }) +
    el("circle", { cx: 14 * k, cy: 0, r: 1.3 * k, fill: "#fffbe6" });
  const b = bot(c, { view: "front", mood: "proud", arms: { near: "wave", far: "down" }, legs: "stand", nearProp: baton });
  const { hand, head } = b.anchors;
  const ox = head.x + 0.45 * h, oy = head.y + 0.1 * h;
  sp.add(hand.x - 14 * k, Math.max(hand.x + 14 * k, ox + 6 * k));
  const note = (i: number): string => {
    const beg = { begin: `${-i}s` };
    const shape = el("ellipse", { rx: 1.8 * k, ry: 1.4 * k, fill: color, transform: "rotate(-20)" }) +
      el("rect", { x: 1.2 * k, y: -7 * k, width: 0.9 * k, height: 7 * k, fill: color });
    return el("g", {}, xform("translate", `${ox} ${oy};${ox + 4 * k} ${oy - 12 * k}`, 3, undefined, beg) +
      anim("opacity", "0;1;1;0", 3, "0;0.2;0.7;1", beg) + shape);
  };
  return b.svg + [0, 1, 2].map(note).join("") + headgear(c, head);
};

/** Front view: a bot holding a coffee mug; it lifts the mug toward its face every 4 s and steam rises in turn. */
const waiting: Scene = (c) => {
  const { k, sp } = c;
  const b = bot(c, { view: "front", mood: "waiting", arms: { near: "hold", far: "down" }, legs: "tap" });
  const { hand, face, head } = b.anchors;
  const lift = { x: 0.6 * (face.x - hand.x), y: 0.6 * (face.y - hand.y) };
  sp.add(Math.min(hand.x, hand.x + lift.x) - 8 * k, Math.max(hand.x, hand.x + lift.x) + 8 * k);
  return b.svg + mug(hand, lift, k) + headgear(c, head);
};

/** Front view: a sleeping bot on a small pillow, with three z letters rising and fading in turn. */
const resting: Scene = (c) => {
  const { x, ground, h, k, sp } = c;
  const b = bot(c, { view: "front", mood: "sleepy", arms: { near: "down", far: "down" }, legs: "sit" });
  const { head } = b.anchors;
  sp.add(x - 0.6 * h, head.x + 0.9 * h);
  const pillow = el("rect", { x: x - 0.6 * h, y: ground - 4 * k, width: 1.2 * h, height: 4 * k, rx: 2 * k, fill: "#d9cdf2", stroke: "#b7a6e0", "stroke-width": 0.5 * k });
  const z = (i: number): string => {
    const beg = { begin: `${-i}s` }, fs = Math.max(6, 0.24 * h) * (1 + 0.25 * i), x0 = head.x + 0.5 * h, y0 = head.y + 0.2 * h;
    return el("g", {}, xform("translate", `${x0} ${y0};${x0 + 2 * k} ${y0 - 0.9 * h}`, 3, undefined, beg) +
      anim("opacity", "0;1;0", 3, "0;0.3;1", beg) +
      el("text", { "font-family": "sans-serif", "font-weight": 700, "font-size": fs, fill: "#c9b8ff" }, "z"));
  };
  return pillow + b.svg + [0, 1, 2].map(z).join("") + headgear(c, head);
};

/** Front view: a happy bot with a green check badge; every 4 s it hops 3 px with a burst of four sparkles. */
const done: Scene = (c) => {
  const { h, k, sp } = c;
  const b = bot(c, { view: "front", mood: "happy", arms: { near: "down", far: "down" }, legs: "stand" });
  const { head } = b.anchors;
  const r = Math.max(4, 0.17 * h), bx = head.x + 0.65 * h, by = head.y - 0.1 * h;
  sp.add(head.x - 0.6 * h, bx + r);
  const badge = el("circle", { cx: bx, cy: by, r, fill: "#3fb950", stroke: "#ffffff", "stroke-width": 0.8 * k }) +
    el("path", { d: `M${bx - 0.45 * r} ${by}L${bx - 0.1 * r} ${by + 0.35 * r}L${bx + 0.5 * r} ${by - 0.35 * r}`,
      fill: "none", stroke: "#ffffff", "stroke-width": 0.22 * r, "stroke-linecap": "round", "stroke-linejoin": "round" });
  const sr = Math.max(2, 0.1 * h), cy = head.y + 0.4 * h, d = 0.55 * h;
  const sparkles = [-135, -45, 45, 135].map((deg) => {
    const a = (deg * Math.PI) / 180;
    return el("g", { transform: `translate(${head.x + d * Math.cos(a)} ${cy + d * Math.sin(a)})` },
      el("g", {}, xform("scale", "0;0.4;1;1", 4, "0;0.08;0.3;1") + anim("opacity", "0;1;0;0", 4, "0;0.08;0.3;1") + star(sr, "#ffe27a")));
  }).join("");
  const hop = el("g", {}, xform("translate", "0 0;0 -3;0 0;0 0", 4, "0;0.08;0.16;1") + b.svg + headgear(c, head));
  return hop + badge + sparkles;
};

/** Front view: a grey bot slumped 2 px lower, with two smoke puffs rising and fading from its head. */
const failed: Scene = (c) => {
  const { h, sp } = c;
  const b = bot(c, { view: "front", mood: "failed", grey: true, arms: { near: "down", far: "down" }, legs: "stand" });
  const { head } = b.anchors;
  const x0 = head.x + 0.1 * h, y0 = head.y + 2;
  sp.add(x0 - 0.2 * h, x0 + 0.3 * h);
  const puff = (i: number): string => {
    const beg = { begin: `${-1.2 * i}s` };
    return el("g", {}, xform("translate", `${x0} ${y0};${x0 + 0.2 * h} ${y0 - 0.6 * h}`, 2.4, undefined, beg) +
      anim("opacity", "0;0.7;0", 2.4, "0;0.2;1", beg) +
      el("circle", { r: 0.06 * h, fill: "#9aa0a8" }, anim("r", `${0.06 * h};${0.14 * h}`, 2.4, undefined, beg)));
  };
  return el("g", { transform: "translate(0 2)" }, b.svg + headgear(c, head)) + [0, 1].map(puff).join("");
};

/** Front view: an alarmed bot with arms up and a slight shake, a round gauge above-right in the red, an amber pulse under it and a sweat drop. */
const alarmed: Scene = (c) => {
  const { x, ground, h, k, sp } = c;
  const b = bot(c, { view: "front", mood: "alarmed", arms: { near: "up", far: "up" }, legs: "stand" });
  const { head } = b.anchors;
  const rg = Math.max(4.5, 0.2 * h), gx = head.x + 0.8 * h, gy = head.y - 0.2 * h;
  sp.add(x - 0.6 * h, gx + 1.12 * rg);
  const pulse = el("g", { transform: `translate(${x} ${ground})` }, el("g", {},
    xform("scale", "0.4;1.2", 1.6) + anim("opacity", "0.7;0", 1.6) +
    el("ellipse", { rx: 0.6 * h, ry: 0.12 * h, fill: "none", stroke: "#f5a623", "stroke-width": 1.2 * k })));
  const drop = el("g", { transform: `translate(${head.x + 0.3 * h} ${head.y + 0.1 * h})` }, el("g", {},
    xform("translate", `0 0;0 ${0.4 * h}`, 1.6) + anim("opacity", "0;1;1;0", 1.6, "0;0.15;0.7;1") +
    el("path", { d: `M0 ${-2.4 * k}C${1.2 * k} ${-0.6 * k} ${1.6 * k} ${0.8 * k} 0 ${1.6 * k}C${-1.6 * k} ${0.8 * k} ${-1.2 * k} ${-0.6 * k} 0 ${-2.4 * k}Z`, fill: "#7fd3ff" })));
  const shake = el("g", {}, xform("translate", "-0.7 0;0.7 0;-0.7 0", 0.15) + b.svg + headgear(c, head));
  return pulse + shake + drop + el("g", { transform: `translate(${gx} ${gy})` }, gauge(rg));
};

const SCENES: Partial<Record<ActName, Scene>> = {
  typing, editing: typing, terminal, running: terminal, searching, reading, thinking, directing, waiting, resting,
  done, failed, alarmed,
};

/** Options for act(). */
export interface ActOptions {
  /** Centre x of the bot. */
  x: number;
  /** y of the feet. */
  ground: number;
  /** Bot height, legs included. */
  h: number;
  color: string;
  /** Headwear for the bot; defaults to "none", or "crown" when the crown flag is set. */
  headwear?: Headwear;
  /** Older flag: true means headwear "crown". Ignored when headwear is given. */
  crown?: boolean;
  /** Prefix for every id the act makes; give each act on one page its own. Defaults to "hk". */
  idPrefix?: string;
}

/** What act() returns: the SVG fragment, and the horizontal room it uses: its width and where it starts, relative to x. */
export interface ActResult {
  svg: string;
  width: number;
  left: number;
}

/**
 * Draws bot `name` doing its activity. x is the bot's centre; it stands on ground and is h tall.
 * Returns { svg, width, left }: an SVG fragment with no root element, and the horizontal room it uses,
 * which can extend past x on either side. The room runs from x + left to x + left + width.
 */
export function act(name: ActName, o: ActOptions): ActResult {
  const scene = Object.hasOwn(SCENES, name) ? SCENES[name] : undefined;
  if (!scene) throw new Error(`act: unknown scene "${name}"`);
  const prefix = o.idPrefix ?? "hk", sp = span();
  const c: Ctx = {
    x: o.x, ground: o.ground, h: o.h, k: o.h / 40, color: o.color,
    headwear: o.headwear ?? (o.crown ? "crown" : "none"), uid: idMaker(prefix), prefix, sp,
  };
  return { svg: el("g", {}, scene(c)), width: sp.width(), left: sp.left() - o.x };
}
