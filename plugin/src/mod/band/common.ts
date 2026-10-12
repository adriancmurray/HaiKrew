/**
 * Shared constants and helpers for the band's drawings: the canvas size, colour mixing, seeded
 * randomness, sky palettes, the moon's phase and the per-call id maker. Pure: every drawing returns a string and
 * touches no DOM.
 */

/** The default canvas width in scene pixels; scenery takes any width. */
export const W = 1080;
/** Canvas height in scene pixels. */
export const H = 81;
/** y of the ground line in scene pixels. */
export const GROUND = 72;

/** A time of day for the sky and the scenery. */
export type TimeOfDay = "dawn" | "day" | "dusk" | "night";
/** A sky gradient: top, middle and bottom colours, the haze distant scenery fades toward, and whether it is night. */
export interface SkyPalette {
  top: string;
  mid: string;
  bot: string;
  haze: string;
  night: boolean;
}
/** The sky palette for each time of day. */
export const SKY: Record<TimeOfDay, SkyPalette> = {
  dawn: { top: "#2f3a6e", mid: "#c9708a", bot: "#f3b27a", haze: "#e9a991", night: false },
  day: { top: "#4f86cf", mid: "#86b3e6", bot: "#cfe4f7", haze: "#bcd6ef", night: false },
  dusk: { top: "#33285c", mid: "#9c4f78", bot: "#f08f5c", haze: "#c97a78", night: false },
  night: { top: "#0a1230", mid: "#17224a", bot: "#2b3a68", haze: "#2a3762", night: true },
};

const SYNODIC_DAYS = 29.530588853;
const NEW_MOON_MS = Date.UTC(2000, 0, 6, 18, 14);
const DAY_MS = 86_400_000;

/** Moon phase at `ms` as a fraction of the synodic month: 0 new, 0.5 full. */
export function moonPhase(ms: number): number {
  const cycles = (ms - NEW_MOON_MS) / DAY_MS / SYNODIC_DAYS;
  return cycles - Math.floor(cycles);
}

/** Makes an SVG id for a gradient, mask, clip or filter. */
export type Uid = (label: string) => string;

type Rgb = [number, number, number];

function hexRgb(hex: string): Rgb {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

function rgbHex(c: Rgb): string {
  return "#" + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
}

/** The colour a fraction t of the way from a to b, both as #rrggbb. */
export function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexRgb(a), [br, bg, bb] = hexRgb(b);
  return rgbHex([ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t]);
}

/** The colour moved a fraction t toward white. */
export const lighten = (c: string, t: number): string => mix(c, "#ffffff", t);

/** The colour moved a fraction t toward black. */
export const darken = (c: string, t: number): string => mix(c, "#000000", t);

/** A seeded 0..1 random, so drawings are stable between renders. */
export function rand(seed: number): number {
  const s = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * An id maker for one drawing call: make("g") gives `${prefix}-g1`, then `${prefix}-g2`, and so on. Each call of
 * a drawing function makes its own maker, so the same arguments always give the same ids.
 */
export function idMaker(prefix: string): Uid {
  let n = 0;
  return (label) => `${prefix}-${label}${++n}`;
}
