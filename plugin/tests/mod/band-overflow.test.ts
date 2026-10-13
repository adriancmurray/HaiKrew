/** The band's overflow mark: a "+N" after the last bot when bots were not drawn, with a card that says how many; none when every bot is drawn. */
import { expect, test } from "claude-code/testing";
import type { Crew, Row } from "../../src/mod/crew.ts";
import { bandScene } from "../../src/mod/band/scene.ts";
import { crewBand } from "../../src/mod/pane-home.ts";
import { defaults } from "../../src/schema.ts";
import type { Settings } from "../../src/schema.ts";
import { pxOf } from "../../src/mod/ui.ts";
import type { Ui } from "../../src/mod/ui.ts";

const BAND = { ...defaults().band, sky: "night", scenery: "city", season: "winter", clouds: true } as Settings["band"];
const NOW = new Date(2026, 0, 12, 23, 0).getTime();
// Each part returns its props, so the band's tree reads back as data.
const UI = { Box: (p: unknown) => p, Text: (p: unknown) => p, Button: (p: unknown) => p, Svg: (p: unknown) => p } as Ui;
/** 131 columns: about 1,493 scene pixels wide, too narrow for 16 agents. */
const COLS = 131;

function crew(count: number): Crew {
  const rows: Row[] = Array.from({ length: count }, (_, i) => ({
    id: `r${i}`, depth: 0, name: `r${i}`, type: "agent", model: "haiku", task: "", state: "working", elapsedMs: 0,
    calls: 0, last: "Read a.ts", tokens: 0, cached: 0, over: false,
  }));
  return { rows, working: count, lead: { state: "directing", model: "opus" } };
}

/** The first element under `node` whose key is `key`, searching children depth first. */
function byKey(node: unknown, key: string): { children?: unknown } | undefined {
  if (!node || typeof node !== "object") return undefined;
  const props = node as { key?: unknown; children?: unknown };
  if (props.key === key) return props;
  for (const child of Array.isArray(props.children) ? props.children : []) {
    const hit = byKey(child, key);
    if (hit) return hit;
  }
  return undefined;
}

function bandOf(count: number): unknown {
  return crewBand(UI, crew(count), COLS, true, { band: BAND, messages: {}, now: NOW, open: () => null, openAgent: () => null });
}

test("a band that drops bots marks the drawing with +N after the last bot", () => {
  const dropped = bandScene(crew(60), { width: pxOf(COLS), band: BAND, now: NOW }).overflow;
  expect(dropped > 0).toBe(true);
  const mark = byKey(bandOf(60), "band-more");
  const label = (mark?.children as Array<{ children?: unknown }>)[0];
  expect(label?.children).toBe(`+${dropped}`);
});

test("the mark's card says how many agents are not drawn", () => {
  const dropped = bandScene(crew(60), { width: pxOf(COLS), band: BAND, now: NOW }).overflow;
  const card = ((byKey(bandOf(60), "band-more")?.children ?? []) as Array<{ children?: unknown }>)[1];
  const line = (card?.children as Array<{ children?: unknown }>)[0];
  expect(line?.children).toBe(`${dropped} more ${dropped === 1 ? "agent" : "agents"} not drawn`);
});

test("a band that draws every bot has no mark", () => {
  expect(byKey(bandOf(2), "band-more")).toBe(undefined);
});
