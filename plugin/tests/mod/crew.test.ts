/** Crew checks: the roster follows a spawn, its tool calls and its stop, nests children, and the scene packs to its cells. */
import { expect, test } from "claude-code/testing";
import { fmtElapsed, noteSpawn, noteStop, noteTokens, noteToolCall, resetCrew, snapshot } from "../../src/mod/crew.ts";
import type { Row } from "../../src/mod/crew.ts";
import { activityOf, layout, packCells, PIXEL_ROWS, scene, SCENE_ROWS } from "../../src/mod/sprites.ts";

const EMPTY = { rows: [], working: 0 };

function rowWith(state: Row["state"], last: string): Row {
  return { id: "x", depth: 0, name: "agent", model: "haiku", task: "", state, elapsedMs: 0, calls: 0, last, tokens: 0, cached: 0, over: false };
}

test("a tool call's family sets the activity, unknown or empty calls think, and an end state overrides both", () => {
  const cases: Array<[string, string]> = [
    ["Read a.ts", "reading"], ["Grep foo", "reading"], ["Glob *.ts", "reading"], ["LS /", "reading"], ["NotebookRead n", "reading"],
    ["Edit a.ts", "editing"], ["Write a.ts", "editing"], ["MultiEdit a.ts", "editing"], ["NotebookEdit n", "editing"],
    ["Bash npm test", "running"], ["WebSearch q", "web"], ["WebFetch http", "web"], ["Agent x", "directing"], ["Task x", "directing"],
    ["Mystery x", "thinking"], ["constructor x", "thinking"], ["", "thinking"],
  ];
  for (const [last, want] of cases) expect(activityOf(rowWith("working", last))).toBe(want);
  expect(activityOf(rowWith("done", "Bash npm test"))).toBe("done");
  expect(activityOf(rowWith("failed", "Read a.ts"))).toBe("failed");
});

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
  expect(crew.rows[1].name).toBe("helper");
});

test("live agents merge in and elapsed time reads as m:ss", () => {
  resetCrew();
  const crew = snapshot([{ id: "x", type: "Explore", description: "look around", status: "running" }], 0);
  expect(crew.rows[0]).toMatchObject({ name: "Explore", state: "working", task: "look around" });
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

test("a subagent's tokens add up step by step and cross the warning once", () => {
  resetCrew();
  noteSpawn({ subagentType: "haiku-coder" }, { model: "claude-haiku-5-5", agentId: "t1" }, 0);
  expect(noteTokens("t1", { input_tokens: 500, output_tokens: 100 }, 1000, 1)).toEqual({ total: 600, crossed: false });
  expect(noteTokens("t1", { input_tokens: 400, output_tokens: 100 }, 1000, 2)).toEqual({ total: 1100, crossed: true });
  expect(noteTokens("t1", { input_tokens: 400, output_tokens: 0 }, 1000, 3)).toEqual({ total: 1500, crossed: false });
  expect(noteTokens(undefined, { input_tokens: 5 }, 1000, 4)).toEqual({ total: 0, crossed: false });
  expect(noteTokens("t2", { input_tokens: 5000 }, 0, 5).crossed).toBe(false);
  const row = snapshot([], 10).rows.find((r) => r.id === "t1");
  expect(row).toMatchObject({ tokens: 1500, over: true });
});
