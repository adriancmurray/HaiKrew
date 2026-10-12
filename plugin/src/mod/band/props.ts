/**
 * Building blocks shared by the band's drawings: the SVG element serialiser and SMIL helpers, the act props and
 * headwear, and the scenery's geometry (ridges, pines, buildings). Pure: each returns an SVG fragment or a number
 * list, and ids come from the caller's maker.
 */
import type { Anchor } from "./bot.ts";
import type { Uid } from "./common.ts";
import { H, W, darken, lighten, rand } from "./common.ts";

/** Headwear an act can put on its bot. */
export type Headwear = "crown" | "wizard" | "cap" | "none";
/** The attributes of one SVG element. */
export type Attrs = Record<string, string | number | undefined>;
/** A rectangle in scene pixels. */
export interface Box { x: number; y: number; w: number; h: number }
/** A point in scene pixels. */
export interface Point { x: number; y: number }
/** A point of a ridge or pine line as [x, y]. */
export type Pt = [number, number];
/** A building in the city skyline: left edge, width, and roof height, in scene pixels. */
export interface Tower { x: number; w: number; top: number }

const CROWN_GEM = "#e0282e";
const GEM_BLUE = "#2f6fe0";
const WIZARD = "#6b4fa8";
const CAP = "#d0533f";

/** Numbers are rounded for output; anything else, NaN and undefined included, is written as-is so bad anchors show. */
const val = (v: string | number | undefined): string | number | undefined => (typeof v === "number" ? +v.toFixed(2) : v);

/** Serialises one SVG element. An empty inner string makes it self-closing. */
export function el(tag: string, attrs: Attrs = {}, inner = ""): string {
  const a = Object.entries(attrs).map(([k, v]) => ` ${k}="${val(v)}"`).join("");
  return inner ? `<${tag}${a}>${inner}</${tag}>` : `<${tag}${a}/>`;
}

/** A looping SMIL element; keyTimes, when given, pairs one-to-one with the ;-separated values. */
function loop(tag: string, a: Attrs, dur: number, keyTimes?: string, extra: Attrs = {}): string {
  return el(tag, { ...a, dur: `${dur}s`, repeatCount: "indefinite", ...(keyTimes ? { keyTimes } : {}), ...extra });
}

/** A looping <animate> on one attribute. */
export const anim = (attributeName: string, values: string, dur: number, keyTimes?: string, extra?: Attrs): string =>
  loop("animate", { attributeName, values }, dur, keyTimes, extra);

/** A looping <animateTransform>. */
export const xform = (type: string, values: string, dur: number, keyTimes?: string, extra?: Attrs): string =>
  loop("animateTransform", { attributeName: "transform", type, values }, dur, keyTimes, extra);

/** A four-point sparkle centred on the origin. */
export const star = (r: number, fill: string): string =>
  el("path", { d: `M0 ${-r}Q0 0 ${r} 0Q0 0 0 ${r}Q0 0 ${-r} 0Q0 0 0 ${-r}Z`, fill });

/** A radial gradient that fades one colour from opacity a at the centre to clear at the rim. */
export const glowDef = (id: string, color: string, a: number): string =>
  el("radialGradient", { id }, el("stop", { offset: 0, "stop-color": color, "stop-opacity": a }) +
    el("stop", { offset: 1, "stop-color": color, "stop-opacity": 0 }));

/** Rows of tiny coloured bars scrolling up inside a clipped box; five rows repeat so the loop is seamless. */
export function scrollLines(box: Box, colours: string[], gap: number, dur: number, uid: Uid): string {
  const cid = uid("clp"), period = 5 * gap;
  const rows = Array.from({ length: 15 }, (_, i) => {
    const seed = (i % 5) + 1;
    return el("rect", { x: box.x + box.w * (0.08 + 0.15 * rand(seed + 6)), y: box.y + i * gap,
      width: box.w * (0.25 + 0.5 * rand(seed)), height: gap * 0.45, fill: colours[i % 5] });
  }).join("");
  return el("clipPath", { id: cid }, el("rect", { x: box.x, y: box.y, width: box.w, height: box.h })) +
    el("g", { "clip-path": `url(#${cid})` }, el("g", {}, xform("translate", `0 0;0 ${-period}`, dur) + rows));
}

/** A magnifying glass in the near hand's prop space: handle at the origin, light-blue lens ahead, glint sweeping across it every 2 s. */
export function magnifier(k: number, uid: Uid): string {
  const r = 4.5 * k, L = 6 * k, cx = L + r, id = uid("lns");
  const glint = el("g", {}, xform("translate", `${cx - 2 * r} 0;${cx + 2 * r} 0`, 2) +
    el("rect", { x: -0.6 * k, y: -1.6 * r, width: 1.2 * k, height: 3.2 * r, fill: "#ffffff", opacity: 0.7, transform: "rotate(25)" }));
  return el("line", { x1: 0, y1: 0, x2: L, y2: 0, stroke: "#6b4a2b", "stroke-width": 1.6 * k, "stroke-linecap": "round" }) +
    el("circle", { cx, cy: 0, r, fill: "#bfe3ff", "fill-opacity": 0.45, stroke: "#3b3f4f", "stroke-width": 1.4 * k }) +
    el("clipPath", { id }, el("circle", { cx, cy: 0, r })) +
    el("g", { "clip-path": `url(#${id})` }, glint);
}

/** A coffee mug drawn upright in world space at the hand: it lifts by the given offset every 4 s and its steam rises straight up. */
export function mug(hand: Point, lift: Point, k: number): string {
  const wisps = [-1, 0, 1].map((i) => {
    const beg = { begin: `${-0.8 * (i + 1)}s` };
    return el("g", {}, xform("translate", `${2 * i * k} ${-4 * k};${2 * i * k} ${-12 * k}`, 2.4, undefined, beg) +
      anim("opacity", "0;0.8;0", 2.4, "0;0.3;1", beg) +
      el("path", { d: `M0 0C${-1.5 * k} ${-1.5 * k} ${1.5 * k} ${-3 * k} 0 ${-4.5 * k}`, fill: "none", stroke: "#8d96a8", "stroke-width": 0.9 * k, "stroke-linecap": "round" }));
  }).join("");
  const body = el("rect", { x: -3.5 * k, y: -4 * k, width: 7 * k, height: 8 * k, rx: k, fill: "#f4f4f0", stroke: "#a9a9a0", "stroke-width": 0.4 * k }) +
    el("ellipse", { cx: 0, cy: -3.4 * k, rx: 3 * k, ry: 0.9 * k, fill: "#6b4226" }) +
    el("path", { d: `M${3.5 * k} ${-2.5 * k}H${5.5 * k}A${2.5 * k} ${2.5 * k} 0 0 1 ${5.5 * k} ${2.5 * k}H${3.5 * k}`, fill: "none", stroke: "#f4f4f0", "stroke-width": 1.1 * k, "stroke-linecap": "round" });
  const raised = el("g", {}, xform("translate", `0 0;${lift.x} ${lift.y};${lift.x} ${lift.y};0 0`, 4, "0;0.3;0.7;1") + wisps + body);
  return el("g", { transform: `translate(${hand.x} ${hand.y})` }, raised);
}

/** A circular arc of radius r from angle a0 to a1, in degrees clockwise from 12 o'clock. */
function arcPath(r: number, a0: number, a1: number): string {
  const p = (a: number): string => `${r * Math.sin((a * Math.PI) / 180)} ${-r * Math.cos((a * Math.PI) / 180)}`;
  return `M${p(a0)}A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${p(a1)}`;
}

/** A round gauge centred on the origin: dark dial, cream rim, green-amber-red arc, and a needle that swings into the red and trembles there. */
export function gauge(rg: number): string {
  const ra = 0.72 * rg, sw = Math.max(1, 0.22 * rg);
  const zone = (a0: number, a1: number, fill: string): string => el("path", { d: arcPath(ra, a0, a1), fill: "none", stroke: fill, "stroke-width": sw });
  const needle = el("g", {}, xform("rotate", "-80;70;64;74;66;72;70;70;-80", 4, "0;0.15;0.25;0.35;0.45;0.55;0.65;0.9;1") +
    el("line", { x1: 0, y1: 0, x2: 0, y2: -0.8 * ra, stroke: "#e5484d", "stroke-width": Math.max(0.8, 0.12 * rg), "stroke-linecap": "round" }));
  return el("circle", { r: 1.12 * rg, fill: "#f3e9d2" }) + el("circle", { r: rg, fill: "#262624" }) +
    zone(-120, -40, "#3fb950") + zone(-40, 20, "#f5a623") + zone(20, 120, "#e5484d") + needle +
    el("circle", { r: 0.12 * rg, fill: "#f3e9d2" });
}

/** The three-point gold crown, with a sparkle that glints every 5 s. Its base sits a little below the head anchor. */
function crown(head: Anchor, h: number, uid: Uid): string {
  const w = 0.5 * h, t = 0.42 * w, k = h / 40, gid = uid("crn");
  const d = `M${-w / 2} 0V${-t}L${-w / 4} ${-0.45 * t}L0 ${-t}L${w / 4} ${-0.45 * t}L${w / 2} ${-t}V0Z`;
  const gem = (gx: number, fill: string): string => el("circle", { cx: gx, cy: -0.3 * t, r: 1.1 * k, fill, stroke: "#5a3a06", "stroke-width": 0.3 * k });
  const sparkle = el("g", { transform: `translate(${w * 0.45} ${-t * 1.1})` },
    el("g", {}, xform("scale", "0;1;0;0", 5, "0;0.05;0.1;1") + star(1.6 * k, "#fffbe6")));
  const body = el("linearGradient", { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 },
    el("stop", { offset: 0, "stop-color": "#ffe27a" }) + el("stop", { offset: 1, "stop-color": "#d49a16" })) +
    el("path", { d, fill: `url(#${gid})`, stroke: "#8a5f08", "stroke-width": 0.4 * k, "stroke-linejoin": "round" }) +
    gem(0, CROWN_GEM) + gem(-0.3 * w, GEM_BLUE) + gem(0.3 * w, GEM_BLUE) + sparkle;
  return el("g", { transform: `translate(${head.x} ${head.y + k})` }, body);
}

/** A soft purple cone with a shaded fill, a small brim and a gold star that glints every 5 s. */
function wizard(head: Anchor, h: number, uid: Uid): string {
  const k = h / 40, cw = 0.4 * h, ch = 0.55 * h, tip = 0.1 * h, gid = uid("wiz");
  const d = `M${-cw / 2} 0Q${-cw / 4} ${-ch * 0.6} ${tip} ${-ch}Q${cw / 3} ${-ch * 0.55} ${cw / 2} 0Z`;
  const shade = el("linearGradient", { id: gid, x1: 0, y1: 0, x2: 1, y2: 0 },
    el("stop", { offset: 0, "stop-color": lighten(WIZARD, 0.25) }) + el("stop", { offset: 0.5, "stop-color": WIZARD }) +
    el("stop", { offset: 1, "stop-color": darken(WIZARD, 0.3) }));
  const glint = el("g", { transform: `translate(${tip * 0.5} ${-ch * 0.45})` },
    el("g", {}, xform("scale", "0;1;0;0", 5, "0;0.05;0.1;1") + star(2 * k, "#ffd84d")));
  const brim = el("ellipse", { cx: 0, cy: 0, rx: 0.34 * h, ry: 0.06 * h, fill: darken(WIZARD, 0.25) });
  return el("g", { transform: `translate(${head.x} ${head.y + k})` }, shade + el("path", { d, fill: `url(#${gid})` }) + glint + brim);
}

/**
 * A red cap: a shaded dome with a button and a brim. The brim sits forward of the head in side view (face 1 or -1)
 * and centred in front view (face 0).
 */
function cap(head: Anchor, h: number, face: number, uid: Uid): string {
  const k = h / 40, w = 0.42 * h, dh = 0.2 * h, gid = uid("cap");
  const d = `M${-w / 2} 0Q${-w / 2} ${-dh * 1.6} 0 ${-dh}Q${w / 2} ${-dh * 1.6} ${w / 2} 0Z`;
  const shade = el("linearGradient", { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 },
    el("stop", { offset: 0, "stop-color": lighten(CAP, 0.2) }) + el("stop", { offset: 1, "stop-color": darken(CAP, 0.15) }));
  const brim = el("ellipse", { cx: face * 0.2 * h, cy: 0.02 * h, rx: 0.26 * h, ry: 0.05 * h, fill: darken(CAP, 0.3) });
  const button = el("circle", { cx: 0, cy: -dh, r: 0.04 * h, fill: darken(CAP, 0.3) });
  return el("g", { transform: `translate(${head.x} ${head.y + k})` }, shade + el("path", { d, fill: `url(#${gid})` }) + brim + button);
}

/** The headwear for a bot whose head anchor is `at`. face is the side-view facing (1 or -1), or 0 for a front view. */
export function headwearArt(kind: Headwear, at: Anchor, h: number, face: number, uid: Uid): string {
  if (kind === "crown") return crown(at, h, uid);
  if (kind === "wizard") return wizard(at, h, uid);
  if (kind === "cap") return cap(at, h, face, uid);
  return "";
}

/** A list entry by index. Every index used here is in range, so a miss is a bug and throws instead of yielding undefined. */
export function item<T>(a: readonly T[], i: number): T {
  const v = a[i];
  if (v === undefined) throw new RangeError(`scenery: index ${i} is out of range`);
  return v;
}
/** Rounds to one decimal, which keeps the markup small. */
export const f = (v: number): number => Math.round(v * 10) / 10;
/** Seeded 0..1 value for a (seed, index) pair; integer seeds keep it stable. */
export const seeded = (seed: number, i: number): number => rand(seed * 1000 + i);
/** Sequential reader over one seed: each call returns the next value. */
export const stream = (seed: number): (() => number) => {
  let i = 0;
  return () => seeded(seed, i++);
};
/** A filled path, or nothing when there is no geometry. */
export const path = (fill: string, d: string, extra = ""): string => (d ? `<path fill="${fill}" d="${d}"${extra}/>` : "");

/** Catmull-Rom segments through pts, as cubic Béziers. Starts from the current point. */
export function curve(pts: Pt[]): string {
  let d = "";
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = item(pts, Math.max(i - 1, 0)), p1 = item(pts, i), p2 = item(pts, i + 1), p3 = item(pts, Math.min(i + 2, pts.length - 1));
    const c1: Pt = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2: Pt = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${f(c1[0])},${f(c1[1])} ${f(c2[0])},${f(c2[1])} ${f(p2[0])},${f(p2[1])}`;
  }
  return d;
}
/** Path data for a smooth open line through pts. */
export const openCurve = (pts: Pt[]): string => `M${f(item(pts, 0)[0])},${f(item(pts, 0)[1])}${curve(pts)}`;
/** Closed silhouette: a smooth line through pts, then straight down to the bottom edge. */
export function ridge(pts: Pt[]): string {
  const b = item(pts, pts.length - 1);
  return `${openCurve(pts)}L${f(b[0])},${H}L${f(item(pts, 0)[0])},${H}Z`;
}
/** Peaks every `step` px, from just off the left edge to just off the right of a `width`; heights run from base - amp to base. sharp > 1 makes peaks pointier. */
export function ridgePts(seed: number, base: number, amp: number, step: number, sharp = 1, width = W): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0, x = -step; x <= width + step; i++, x += step) pts.push([x, base - amp * Math.pow(seeded(seed, i), sharp)]);
  return pts;
}
/** Height of a ridge at x, interpolated between its points. */
export function yAt(pts: Pt[], x: number): number {
  const x0 = item(pts, 0)[0], step = item(pts, 1)[0] - x0;
  const i = Math.min(Math.max(Math.floor((x - x0) / step), 0), pts.length - 2);
  const [xi, yi] = item(pts, i), yn = item(pts, i + 1)[1];
  return yi + (yn - yi) * ((x - xi) / step);
}
/** A pine: a slim spike with concave sides, apex at base - h. */
function pine(x: number, base: number, h: number): string {
  const w = h * 0.3, top = base - h, mid = base - h * 0.4;
  return `M${f(x)},${f(top)}Q${f(x + w * 0.2)},${f(mid)} ${f(x + w)},${f(base)}L${f(x - w)},${f(base)}Q${f(x - w * 0.2)},${f(mid)} ${f(x)},${f(top)}Z`;
}
/** One path of pines spread across a `width`, each standing `sink` px below the ridge. */
export function pines(seed: number, ridgeP: Pt[], count: number, hMin: number, hMax: number, sink = 2, width = W): string {
  const r = stream(seed);
  let d = "";
  for (let i = 0; i < count; i++) {
    const x = (i + 0.2 + 0.6 * r()) * (width / count);
    d += pine(x, yAt(ridgeP, x) + sink, hMin + (hMax - hMin) * r());
  }
  return d;
}
/** Building boxes from left to right across a `width`; roofs fall between bottom - minH and bottom - maxH. */
export function boxes(seed: number, bottom: number, minH: number, maxH: number, wMin: number, wMax: number, width = W): Tower[] {
  const r = stream(seed), out: Tower[] = [];
  for (let x = -6; x < width + 6;) {
    const w = wMin + (wMax - wMin) * r();
    out.push({ x, w, top: bottom - (minH + (maxH - minH) * r()) });
    x += w;
  }
  return out;
}
/** Skyline outline for building boxes, down to the bottom edge. */
export function skyline(list: Tower[]): string {
  let d = `M${f(item(list, 0).x)},${H}`;
  for (const b of list) d += `V${f(b.top)}H${f(b.x + b.w)}`;
  return `${d}V${H}Z`;
}
/** Snow caps: for every high apex, a band over its top quarter, spanning from one neighbouring valley to the other. Clip it to the range silhouette. */
export function snowcaps(pts: Pt[], base: number, amp: number): string {
  let d = "";
  for (let i = 1; i < pts.length - 1; i++) {
    const [, y] = item(pts, i), [xl, yl] = item(pts, i - 1), [xr, yr] = item(pts, i + 1);
    if (y < yl && y < yr && y < base - 0.6 * amp) {
      const cut = y + 0.25 * (Math.min(yl, yr) - y);
      d += `M${f(xl)},${f(y - 10)}H${f(xr)}V${f(cut)}H${f(xl)}Z`;
    }
  }
  return d;
}
