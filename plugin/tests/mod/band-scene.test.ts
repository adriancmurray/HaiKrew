/** The band's scene: equal inputs draw equal markup, the crew stays small and in its room, each state and activity draws its act, and the sky follows the settings and the clock. */
import { expect, test } from "claude-code/testing";
import type { LeadActivity, Crew, Lead, Row } from "../../src/mod/crew.ts";
import type { ActName } from "../../src/mod/band/acts.ts";
import { moonPhase } from "../../src/mod/band/common.ts";
import { bandLook, bandScene, leadAct, leadOf, rowAct } from "../../src/mod/band/scene.ts";
import type { Settings } from "../../src/schema.ts";

const BAND = { show: true, sky: "night", scenery: "city", season: "none", clouds: true, headwear: "crown",
  haiku_color: "#9b7fc7", sonnet_color: "#4f9c98", opus_color: "#d97757" } as Settings["band"];
const NIGHT = new Date(2026, 9, 12, 23, 0).getTime();
const MODELS = ["haiku", "sonnet", "opus"];

function row(id: string, model = "haiku", state: Row["state"] = "working", over = false, last = "Read a.ts"): Row {
  return { id, depth: 0, name: id, type: "agent", model, task: "", state, elapsedMs: 0, calls: 0, last, tokens: 0, cached: 0, over };
}

function crew(rows: Row[], lead?: Lead): Crew {
  return { rows, working: rows.filter((r) => r.state === "working").length, lead };
}

function band(over: Record<string, string>): Settings["band"] {
  return { ...BAND, ...over } as Settings["band"];
}

test("equal inputs draw equal markup", () => {
  const c = crew([row("a"), row("b", "sonnet", "working", false, "Bash ls")], { state: "working", model: "opus", activity: "web" });
  const o = { width: 900, band: BAND, now: NIGHT };
  expect(bandScene(c, o).svg).toBe(bandScene(c, { ...o }).svg);
});

test("the drawing is as wide as asked, with the sun or moon at width minus 30", () => {
  const { svg, orb } = bandScene(crew([]), { width: 900, band: BAND, now: NIGHT });
  expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 81">')).toBe(true);
  expect(orb.x).toBe(870);
  expect(orb.kind).toBe("moon");
});

test("a crew of nine in the city at night stays under 125000 characters", () => {
  const rows = Array.from({ length: 9 }, (_, i) => row(`r${i}`, MODELS[i % 3]));
  const { svg } = bandScene(crew(rows, { state: "directing", model: "opus" }), { width: 1080, band: BAND, now: NIGHT });
  expect(svg.length).toBeLessThan(125000);
});

test("spots never overlap, stay left of the orb room, and the rows that do not fit are overflow", () => {
  for (const width of [300, 600, 1080]) {
    const rows = Array.from({ length: 12 }, (_, i) => row(`r${i}`, MODELS[i % 3], "working", false, i % 2 ? "Bash ls" : "Read a.ts"));
    const { spots, overflow } = bandScene(crew(rows, { state: "working", model: "opus", activity: "running" }), { width, band: BAND, now: NIGHT });
    for (let i = 1; i < spots.length; i++) {
      const prev = spots[i - 1], next = spots[i];
      expect(prev !== undefined && next !== undefined && next.x >= prev.x + prev.w).toBe(true);
    }
    for (const s of spots) expect(s.x + s.w <= width - 70).toBe(true);
    expect(spots.length - 1 + overflow).toBe(rows.length);
  }
  expect(bandScene(crew(Array.from({ length: 12 }, (_, i) => row(`r${i}`))), { width: 300, band: BAND, now: NIGHT }).overflow).toBeGreaterThan(0);
});

test("the lead's spot is first and its bots stand on the ground line", () => {
  const { spots } = bandScene(crew([row("a", "sonnet")], { state: "working", model: "opus" }), { width: 900, band: BAND, now: NIGHT });
  expect(spots[0]?.id).toBe("lead");
  expect(spots[0]?.top).toBe(27);
  expect(spots[1]?.top).toBe(43);
});

test("the main agent's act follows its state, and while it works, its activity", () => {
  expect(leadAct({ state: "resting", model: "opus" })).toBe("resting");
  expect(leadAct({ state: "waiting", model: "opus" })).toBe("waiting");
  expect(leadAct({ state: "directing", model: "opus" })).toBe("directing");
  const working: Array<[LeadActivity, ActName]> = [["thinking", "thinking"], ["writing", "typing"], ["reading", "reading"],
    ["editing", "typing"], ["running", "terminal"], ["web", "searching"], ["directing", "directing"], ["other", "thinking"]];
  for (const [activity, want] of working) expect(leadAct({ state: "working", model: "opus", activity })).toBe(want);
  expect(leadAct({ state: "working", model: "opus" })).toBe("thinking");
});

test("a subagent's act follows its activity, and an agent past its token warning is alarmed", () => {
  expect(rowAct(row("a", "haiku", "working", false, "Read a.ts"))).toBe("reading");
  expect(rowAct(row("a", "haiku", "working", false, "Edit a.ts"))).toBe("typing");
  expect(rowAct(row("a", "haiku", "working", false, "Bash ls"))).toBe("terminal");
  expect(rowAct(row("a", "haiku", "working", false, "WebSearch x"))).toBe("searching");
  expect(rowAct(row("a", "haiku", "working", false, "Agent x"))).toBe("directing");
  expect(rowAct(row("a", "haiku", "working", false, ""))).toBe("thinking");
  expect(rowAct(row("a", "haiku", "done", false, "Bash ls"))).toBe("done");
  expect(rowAct(row("a", "haiku", "failed", false, "Read a.ts"))).toBe("failed");
  expect(rowAct(row("a", "haiku", "working", true, "Bash ls"))).toBe("alarmed");
});

test("with no lead drawn, the main agent directs while anyone works and rests otherwise, on opus", () => {
  expect(leadOf(crew([row("a")]))).toEqual({ state: "directing", model: "opus" });
  expect(leadOf(crew([]))).toEqual({ state: "resting", model: "opus" });
});

test("a live sky follows the clock, a fixed one holds, and auto seasons follow the month", () => {
  const at = (hour: number, month: number): number => new Date(2026, month, 12, hour, 30).getTime();
  const live = band({ sky: "live", season: "auto" });
  expect(bandLook(live, at(6, 9)).time).toBe("dawn");
  expect(bandLook(live, at(12, 9)).time).toBe("day");
  expect(bandLook(live, at(18, 9)).time).toBe("dusk");
  expect(bandLook(live, at(23, 9)).time).toBe("night");
  expect(bandLook(live, at(3, 9)).time).toBe("night");
  expect(bandLook(band({ sky: "dusk" }), at(12, 9)).time).toBe("dusk");
  expect(bandLook(live, at(12, 0)).season).toBe("winter");
  expect(bandLook(live, at(12, 11)).season).toBe("winter");
  expect(bandLook(live, at(12, 3)).season).toBe("spring");
  expect(bandLook(live, at(12, 6)).season).toBe("summer");
  expect(bandLook(live, at(12, 9)).season).toBe("autumn");
  expect(bandLook(band({ season: "none" }), at(12, 0)).season).toBe("none");
  expect(bandLook(band({ season: "spring" }), at(12, 0)).season).toBe("spring");
});

test("the moon's phase is 0 at new moon and about half at 14.8 days later", () => {
  const newMoon = Date.UTC(2000, 0, 6, 18, 14);
  expect(Math.abs(moonPhase(newMoon)) < 0.01).toBe(true);
  expect(Math.abs(moonPhase(newMoon + 14.765 * 86_400_000) - 0.5) < 0.01).toBe(true);
});
