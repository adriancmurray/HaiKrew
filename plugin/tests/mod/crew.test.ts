/** Crew checks: the roster follows a spawn, its tool calls and its stop, nests children, and the scene packs to its cells. */
import { expect, test } from "claude-code/testing";
import { fmtElapsed, noteSpawn, noteStop, noteToolCall, resetCrew, rowLine, snapshot } from "../../src/mod/crew.ts";
import { layout, packCells, PIXEL_ROWS, scene, SCENE_ROWS } from "../../src/mod/sprites.ts";

const EMPTY = { rows: [], working: 0 };

test("a spawn, its tool calls and its stop update the roster row", () => {
  resetCrew();
  noteSpawn({ subagentType: "general-purpose", description: "read the readme" }, { model: "haiku", agentId: "a1" }, 0);
  noteToolCall({ agentId: "a1", tool: "Read", file_path: "/repo/docs/README.md" }, 1000);
  noteToolCall({ agentId: "a1", tool: "Bash", command: "npm test" }, 2000);
  let crew = snapshot([], 3000);
  expect(crew.working).toBe(1);
  expect(crew.rows[0]).toMatchObject({ state: "working", calls: 2, last: "Bash npm test", model: "haiku" });
  noteStop("a1", "general-purpose", "fail", 5000);
  crew = snapshot([], 6000);
  expect(crew.working).toBe(0);
  expect(crew.rows[0]).toMatchObject({ state: "failed", elapsedMs: 5000 });
});

test("a finished agent drops from the roster after 60 seconds", () => {
  resetCrew();
  noteSpawn({ subagentType: "Explore" }, { model: "sonnet", agentId: "a2" }, 0);
  noteStop("a2", "Explore", "pass", 1000);
  expect(snapshot([], 30_000).rows.length).toBe(1);
  expect(snapshot([], 61_001).rows.length).toBe(0);
});

test("a nested agent is indented under its parent", () => {
  resetCrew();
  noteSpawn({ subagentType: "lead" }, { model: "opus", agentId: "p" }, 0);
  noteSpawn({ subagentType: "helper", parentAgentId: "p" }, { model: "haiku", agentId: "c" }, 10);
  const crew = snapshot([], 100);
  expect(crew.rows.map((r) => r.depth)).toEqual([0, 1]);
  expect(rowLine(crew.rows[1], 80).startsWith("  ● helper")).toBe(true);
});

test("live agents merge in and the roster line fits its width", () => {
  resetCrew();
  const crew = snapshot([{ id: "x", type: "Explore", description: "look around", status: "running" }], 0);
  expect(crew.rows[0]).toMatchObject({ name: "Explore", state: "working", task: "look around" });
  expect(rowLine(crew.rows[0], 30).length).toBeLessThanOrEqual(30);
  expect(fmtElapsed(65_000)).toBe("1:05");
});

test("an empty roster puts the lead to sleep and the scene packs to its cell count", () => {
  resetCrew();
  const cols = 40;
  const { px, overflow } = scene(EMPTY, cols, 0);
  expect(px.length).toBe(cols * PIXEL_ROWS);
  expect(overflow).toBe(0);
  expect(layout(EMPTY, cols, 0).critters[0].asleep).toBe(true);
  const bytes = atob(packCells(px, cols));
  expect(bytes.length).toBe(cols * SCENE_ROWS * 12);
  expect(bytes.charCodeAt(0)).toBe(0x80);
  expect(bytes.charCodeAt(1)).toBe(0x25);
});

test("more agents than the scene holds report the overflow", () => {
  resetCrew();
  for (let i = 0; i < 12; i++) noteSpawn({ subagentType: `t${i}` }, { model: "haiku", agentId: `o${i}` }, i);
  const crew = snapshot([], 100);
  const { critters, overflow } = layout(crew, 80, 0);
  expect(critters.length).toBe(9);
  expect(overflow).toBe(4);
});
