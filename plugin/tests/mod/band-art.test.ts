/** The band's drawings: every act, bot and scenery renders finite markup, equal arguments give equal strings, and ids stay namespaced. */
import { expect, test } from "claude-code/testing";
import { ACT_NAMES, act } from "../../src/mod/band/acts.ts";
import type { ActName, Headwear } from "../../src/mod/band/acts.ts";
import { bot } from "../../src/mod/band/bot.ts";
import { SCENERY_KINDS, TIMES, scenery } from "../../src/mod/band/scenery.ts";

const COLOR = "#9b7fc7";
const HEADWEAR: Headwear[] = ["none", "crown", "wizard", "cap"];
const NINE_SCENES: ActName[] = ["typing", "terminal", "searching", "reading", "thinking", "directing", "waiting", "resting", "done"];

/** Every id attribute in a fragment, in order. */
function idsOf(svg: string): string[] {
  return [...svg.matchAll(/ id="([^"]+)"/g)].map((m) => m[1] ?? "");
}

test("every act at both heights and every headwear draws finite markup with room", () => {
  for (const name of ACT_NAMES) for (const h of [26, 46]) for (const headwear of HEADWEAR) {
    const { svg, width } = act(name, { x: 300, ground: 72, h, color: COLOR, headwear });
    expect(svg.includes("NaN")).toBe(false);
    expect(svg.includes("undefined")).toBe(false);
    expect(width).toBeGreaterThan(0);
  }
});

test("the crown flag still means the crown headwear", () => {
  const base = { x: 300, ground: 72, h: 40, color: COLOR };
  expect(act("typing", { ...base, crown: true }).svg).toBe(act("typing", { ...base, headwear: "crown" }).svg);
  expect(act("typing", { ...base, crown: false }).svg).toBe(act("typing", { ...base, headwear: "none" }).svg);
});

test("the aliases draw the scenes they name", () => {
  const base = { x: 300, ground: 72, h: 40, color: COLOR };
  expect(act("editing", base).svg).toBe(act("typing", base).svg);
  expect(act("running", base).svg).toBe(act("terminal", base).svg);
});

test("every scenery kind at every time returns an orb of the right kind", () => {
  for (const kind of SCENERY_KINDS) for (const time of TIMES) {
    const { svg, orb } = scenery(kind, time, {});
    expect(svg.startsWith("<svg")).toBe(true);
    expect(orb.kind).toBe(time === "night" ? "moon" : "sun");
    expect(orb.r).toBeGreaterThan(0);
  }
});

test("equal arguments give equal strings for bots, acts and scenery", () => {
  const botOpts = { x: 200, ground: 72, h: 40, color: COLOR, view: "side" as const, mood: "thinking" as const, arms: { near: "chin" as const } };
  expect(bot(botOpts).svg).toBe(bot({ ...botOpts }).svg);
  const actOpts = { x: 300, ground: 72, h: 46, color: COLOR, headwear: "wizard" as const };
  expect(act("searching", actOpts).svg).toBe(act("searching", { ...actOpts }).svg);
  expect(scenery("city", "night", { phase: 0.3 }).svg).toBe(scenery("city", "night", { phase: 0.3 }).svg);
});

test("ids are unique within one drawing", () => {
  for (const name of ACT_NAMES) {
    const ids = idsOf(act(name, { x: 300, ground: 72, h: 46, color: COLOR, headwear: "cap" }).svg);
    expect(new Set(ids).size).toBe(ids.length);
  }
  const ids = idsOf(scenery("mountains", "night", {}).svg);
  expect(new Set(ids).size).toBe(ids.length);
});

test("a different id prefix gives different ids and keeps the drawing", () => {
  const a = act("reading", { x: 300, ground: 72, h: 40, color: COLOR, idPrefix: "a1" }).svg;
  const b = act("reading", { x: 300, ground: 72, h: 40, color: COLOR, idPrefix: "b2" }).svg;
  expect(a === b).toBe(false);
  expect(a.includes('id="a1-')).toBe(true);
  expect(b.includes('id="a1-')).toBe(false);
  expect(scenery("hills", "dusk", { idPrefix: "s1" }).svg.includes('id="s1-')).toBe(true);
  expect(bot({ x: 100, ground: 72, h: 40, color: COLOR, idPrefix: "p1" }).svg.includes('id="p1-')).toBe(true);
});

test("a full band of city night scenery and nine acts stays under 120000 characters", () => {
  const parts = [scenery("city", "night", {}).svg];
  NINE_SCENES.forEach((name, i) => {
    parts.push(act(name, { x: 100 + i * 110, ground: 72, h: 46, color: COLOR, headwear: "wizard", idPrefix: `a${i}` }).svg);
  });
  expect(parts.join("").length).toBeLessThan(120000);
});
