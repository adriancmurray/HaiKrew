/** The band's update bubble: the main agent says an update is available, only when asked; it counts against the size cap, keeps clear of the sun or moon's room, and offers the update on hover. Also the home page's strip. */
import { expect, test } from "claude-code/testing";
import type { Crew, Lead, Row } from "../../src/mod/crew.ts";
import { bandScene } from "../../src/mod/band/scene.ts";
import { crewBand, desktopView, updateStrip } from "../../src/mod/pane-home.ts";
import { anchorAnimations } from "../../src/mod/svg.ts";
import { defaults } from "../../src/schema.ts";
import type { Settings } from "../../src/schema.ts";
import { readState } from "../../src/mod/ledger.ts";
import { view } from "../../src/mod/ui.ts";
import type { Actions, Ui } from "../../src/mod/ui.ts";

const LIMIT = 131072;
const NOW = new Date(2026, 9, 12, 12, 0).getTime();
const TEXT = "A HaiKrew update is available!";
const KINDS = ["mountains", "city", "forest", "hills"];
const WIDTHS = [600, 1500, 2400];
const COUNTS = [0, 16, 60];
const UI = { Box: (p: unknown) => p, Text: (p: unknown) => p, Button: (p: unknown) => p, Svg: (p: unknown) => p, Link: (p: unknown) => p } as Ui;

function crew(count: number): Crew {
  const rows: Row[] = Array.from({ length: count }, (_, i) => ({
    id: `r${i}`, depth: 0, name: `r${i}`, type: "agent", model: ["haiku", "sonnet", "opus"][i % 3] ?? "haiku", task: "",
    state: "working", elapsedMs: 0, calls: 0, last: "Read a.ts", tokens: 0, cached: 0, over: false,
  }));
  const lead: Lead = { state: "working", model: "claude-opus-5-5", activity: "web" };
  return { rows, working: rows.length, lead };
}

const band = (kind: string): Settings["band"] => ({ ...defaults().band, scenery: kind, sky: "night", season: "winter", clouds: true } as Settings["band"]);

/** Every element under `node` as a flat list. */
function all(node: unknown): Array<Record<string, any>> {
  if (!node || typeof node !== "object") return [];
  const el = node as Record<string, any>;
  return [el, ...(Array.isArray(el.children) ? el.children : []).flatMap(all)];
}

test("the bubble is drawn only when asked, and the drawing is otherwise unchanged", () => {
  for (const kind of KINDS) for (const width of WIDTHS) {
    const off = bandScene(crew(3), { width, band: band(kind), now: NOW });
    const on = bandScene(crew(3), { width, band: band(kind), now: NOW, bubble: true });
    expect(off.svg.includes(TEXT) || off.bubble !== undefined).toBe(false);
    expect(on.svg.includes(TEXT) && on.bubble !== undefined).toBe(true);
    expect(bandScene(crew(3), { width, band: band(kind), now: NOW, bubble: false }).svg).toBe(off.svg);
  }
});

test("with the bubble, drawings stay under the host's limit once anchored and the bubble stays clear of the sun or moon", () => {
  const bad: string[] = [];
  for (const kind of KINDS) for (const width of WIDTHS) for (const count of COUNTS) {
    const s = bandScene(crew(count), { width, band: band(kind), now: NOW, bubble: true });
    if (anchorAnimations(s.svg, NOW).length > LIMIT) bad.push(`${kind} ${width} ${count} too long`);
    if (s.bubble && s.bubble.x + s.bubble.w > width - 70) bad.push(`${kind} ${width} ${count} bubble in orb room`);
    if (s.spots.length > bandScene(crew(count), { width, band: band(kind), now: NOW }).spots.length) bad.push(`${kind} ${width} ${count} more bots`);
  }
  expect(bad).toEqual([]);
});

test("the band offers the update on the bubble and on the main agent, only when an update is available", () => {
  view.updateNote = "";
  const run: string[] = [];
  const base = { band: band("city"), messages: {}, now: NOW, open: () => null, openAgent: () => null };
  const plain = all(crewBand(UI, crew(2), 131, true, base));
  expect(plain.some((e) => e.key === "band-update" || e.key === "band-update-now")).toBe(false);
  const els = all(crewBand(UI, crew(2), 131, true, { ...base, update: { latest: "0.6.9", run: () => run.push("ran") } }));
  expect(els.some((e) => e.key === "band-update")).toBe(true);
  expect(els.some((e) => e.children === "Update to 0.6.9")).toBe(true);
  const buttons = els.filter((e) => e.key === "band-update-now");
  expect(buttons.length >= 2).toBe(true); // the bubble's card and the main agent's card
  buttons[0].onPress();
  expect(run).toEqual(["ran"]);
  // The bots' hover targets never overlap: each starts at or past the end of the one before.
  const targets = els.filter((e) => /^band-(lead|r\d)/.test(String(e.key))).sort((a, b) => a.left - b.left);
  expect(targets.length > 1).toBe(true);
  for (let i = 1; i < targets.length; i++) expect(targets[i].left >= targets[i - 1].left + targets[i - 1].width).toBe(true);
});

test("the strip shows the release and an Update button that runs the update; the page has it only when newer", () => {
  view.updateNote = "";
  const calls: string[] = [];
  const act = { update: async () => { calls.push("update"); } } as unknown as Actions;
  const strip = all(updateStrip(UI, act, { latest: "0.6.9", installed: "0.6.8-dev.4" }));
  expect(strip.some((e) => e.children === "HaiKrew 0.6.9 is available (you have 0.6.8-dev.4)")).toBe(true);
  expect(strip.some((e) => String(e.href).endsWith("CHANGELOG.md"))).toBe(true);
  strip.find((e) => e.key === "update-now")?.onPress();
  expect(calls).toEqual(["update"]);
  view.updateNote = "Updated. Restart Claude to use 0.6.9.";
  const done = all(updateStrip(UI, act, { latest: "0.6.9", installed: "0.6.8-dev.4" }));
  expect(done.some((e) => e.key === "update-now")).toBe(false);
  view.updateNote = "";
  const data = { crew: crew(0), settings: defaults(), ledger: readState(undefined), usage: {}, messages: {}, dark: true };
  const page = (update?: { latest: string; installed: string }) => all(desktopView(UI, act, { ...data, update }, null, 80)).some((e) => e.key === "update-strip");
  expect(page({ latest: "0.6.9", installed: "0.6.8" })).toBe(true);
  expect(page()).toBe(false);
});

test("without $.process (the desktop app) the strip and the bubble card hide the button and give the manual steps", () => {
  view.updateNote = "";
  const act = { update: async () => undefined } as unknown as Actions;
  const strip = all(updateStrip(UI, act, { latest: "0.6.9", installed: "0.6.8", manual: true }));
  expect(strip.some((e) => e.key === "update-now")).toBe(false);
  expect(strip.some((e) => String(e.children).startsWith("Update from Claude: /plugin marketplace update haikrew"))).toBe(true);
  const base = { band: band("city"), messages: {}, now: NOW, open: () => null, openAgent: () => null };
  const els = all(crewBand(UI, crew(1), 131, true, { ...base, update: { latest: "0.6.9", manual: true, run: () => null } }));
  expect(els.some((e) => e.key === "band-update-now")).toBe(false);
  expect(els.some((e) => String(e.children).includes("claude plugin update haikrew@haikrew"))).toBe(true);
});
