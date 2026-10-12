/** The band's scene source: reused while what it draws holds, so a redraw does not restart its loops. */
import { expect, test } from "claude-code/testing";
import type { Crew, Row } from "../../src/mod/crew.ts";
import { crewBand } from "../../src/mod/pane-home.ts";
import type { Settings } from "../../src/schema.ts";
import type { Ui } from "../../src/mod/ui.ts";

const BAND = { show: true, sky: "live", clouds: true, headwear: "crown", haiku_color: "#9b7fc7", sonnet_color: "#d97757", opus_color: "#c9963f" } as Settings["band"];
// Each part returns its props, so the band's tree reads back as data.
const UI = { Box: (p: unknown) => p, Text: (p: unknown) => p, Button: (p: unknown) => p, Svg: (p: unknown) => p } as Ui;
const MORNING = new Date(2026, 9, 12, 10, 1).getTime();
const LATER = new Date(2026, 9, 12, 10, 13, 30).getTime();

function row(id: string, state: Row["state"] = "working", last = "Read a.ts"): Row {
  return { id, depth: 0, name: "Ada Lovebytes", type: "agent", model: "haiku", task: "", state, elapsedMs: 0, calls: 0, last, tokens: 0, cached: 0, over: false };
}

function crew(rows: Row[]): Crew {
  return { rows, working: rows.filter((r) => r.state === "working").length, lead: { state: "directing", model: "opus" } };
}

/** The scene's SVG source as the band hands it to the app: the first child of the band is the Svg. */
function sourceAt(now: number, rows: Row[]): string {
  const band = crewBand(UI, crew(rows), 80, false, { band: BAND, messages: {}, now, open: () => null, openAgent: () => null }) as { children: Array<{ source?: string }> };
  return band.children[0]?.source ?? "";
}

test("a redraw in the same quarter hour with the same crew hands over the same source, anchored", () => {
  const rows = [row("band-cache-a")];
  const first = sourceAt(MORNING, rows);
  expect(first).toMatch(/ begin="-?\d+\.\d{3}s"/);
  expect(sourceAt(LATER, rows)).toBe(first);
});

test("a row changing state or activity draws a new source", () => {
  const working = sourceAt(MORNING, [row("band-cache-b")]);
  expect(sourceAt(LATER, [row("band-cache-b", "done")])).not.toBe(working);
  const reading = sourceAt(MORNING, [row("band-cache-c", "working", "Read a.ts")]);
  expect(sourceAt(LATER, [row("band-cache-c", "working", "Edit a.ts")])).not.toBe(reading);
});
