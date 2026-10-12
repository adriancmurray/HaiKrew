/** The desktop band's pixel sky: the hour per mode, moon phase, stars, clouds and the orb's place on the scene. */
import { expect, test } from "claude-code/testing";
import { starPoints } from "../../src/mod/sprites.ts";
import { moonPhase, skyHour, skySvg } from "../../src/mod/sky.ts";

const DAY_MS = 86_400_000;
const NEW_MOON = Date.UTC(2000, 0, 6, 18, 14);

/** The lit pixels (cream rects) inside the moon's orb group. */
function litMoonPixels(body: string): number {
  const start = body.indexOf('class="orb moon"');
  const end = body.indexOf("</g>", start);
  return body.slice(start, end).split('fill="#f3ead2"').length - 1;
}

test("each mode shows its fixed hour, and live and off follow the clock", () => {
  expect(skyHour("live", 14.25)).toBe(14.25);
  expect(skyHour("dawn", 14.25)).toBe(6.5);
  expect(skyHour("day", 14.25)).toBe(12);
  expect(skyHour("dusk", 14.25)).toBe(19);
  expect(skyHour("night", 14.25)).toBe(23);
  expect(skyHour("off", 3)).toBe(3);
});

test("the moon is new at the epoch and half full 14.765 days later", () => {
  expect(Math.abs(moonPhase(NEW_MOON)) < 0.01).toBe(true);
  expect(Math.abs(moonPhase(NEW_MOON + 14.765 * DAY_MS) - 0.5) < 0.01).toBe(true);
});

test("night has stars and a moon", () => {
  const { body, orb } = skySvg(48, 22, { mode: "night", hour: 23, phase: 0.5, clouds: false });
  expect(body.includes('class="star"')).toBe(true);
  expect(body.includes('class="orb moon"')).toBe(true);
  expect(orb.kind).toBe("moon");
});

test("noon has a sun and no stars", () => {
  const { body, orb } = skySvg(48, 22, { mode: "day", hour: 12, phase: 0.5, clouds: false });
  expect(body.includes('class="star"')).toBe(false);
  expect(body.includes('class="orb sun"')).toBe(true);
  expect(orb.kind).toBe("sun");
});

test("the sun rises from the horizon at 6:00, is highest at noon and sets at 19:00", () => {
  const at = (hour: number): number => skySvg(48, 22, { mode: "live", hour, phase: 0, clouds: false }).orb.y;
  expect(at(6)).toBe(18);
  expect(at(12)).toBe(4);
  expect(at(19)).toBe(18);
});

test("clouds are drawn only when asked for", () => {
  expect(skySvg(48, 22, { mode: "day", hour: 12, phase: 0, clouds: false }).body.includes('class="cloud"')).toBe(false);
  const drawn = skySvg(48, 22, { mode: "day", hour: 12, phase: 0, clouds: true }).body.split('class="cloud"').length - 1;
  expect(drawn >= 2).toBe(true);
});

test("off has no gradient, stars or clouds, but keeps the orb", () => {
  const { body } = skySvg(48, 22, { mode: "off", hour: 12, phase: 0.5, clouds: true });
  expect(body.includes("hk-sky")).toBe(false);
  expect(body.includes('class="star"')).toBe(false);
  expect(body.includes('class="cloud"')).toBe(false);
  expect(body.includes('class="orb sun"')).toBe(true);
});

test("the orb sits at cols - 6 and inside the scene", () => {
  for (const cols of [48, 240]) {
    const { body, orb } = skySvg(cols, 22, { mode: "night", hour: 23, phase: 0.5, clouds: false });
    expect(orb.x).toBe(cols - 6);
    expect(orb.x - orb.r >= 0 && orb.x + orb.r <= cols).toBe(true);
    const group = body.slice(body.indexOf('class="orb moon"'), body.indexOf("</g>", body.indexOf('class="orb moon"')));
    const xs = [...group.matchAll(/ x="(-?\d+)"/g)].map((m) => Number(m[1]));
    expect(xs.length > 0 && xs.every((x) => x >= 0 && x < cols)).toBe(true);
  }
});

test("a new moon lights no pixels, and a full moon lights more than a quarter", () => {
  const lit = (phase: number): number => litMoonPixels(skySvg(48, 22, { mode: "night", hour: 23, phase, clouds: false }).body);
  expect(lit(0)).toBe(0);
  expect(lit(0.25) > 0).toBe(true);
  expect(lit(0.5) > lit(0.25)).toBe(true);
});

test("stars spread across the whole width of a wide band", () => {
  const w = 293;
  const xs = starPoints(w, 16, 6).map(([x]) => x);
  for (let t = 0; t < 3; t++) expect(xs.filter((x) => x >= (t * w) / 3 && x < ((t + 1) * w) / 3).length >= xs.length / 5).toBe(true);
});
