/**
 * The dagr exporter through the mounted mod. The test harness answers $.clock.after but cannot fire its callback, so the
 * hooks are checked up to the timer request (a 250 ms debounce is asked for, or not at all when off) and the document
 * and publish path run through a scheduler driven by hand.
 */
import { expect, test } from "claude-code/testing";
import { checkRun } from "../../src/dagr-check.ts";
import { dagrActive, dagrActivity, dagrDocument, dagrGeneration, dagrReset, dagrSpawn, dagrStop } from "../../src/mod/dagr-run.ts";
import { dagrStatus, makeScheduler, setDagrStatus } from "../../src/mod/dagr-schedule.ts";
import { dagrEnsure, dagrPublish, dagrSession, MAX_JSON, NO_CLI } from "../../src/mod/dagr-wire.ts";
import { resetCrew } from "../../src/mod/crew.ts";
import { resetEffort } from "../../src/mod/effort.ts";
import { resetSeams } from "../../src/mod/seam.ts";

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** The engine beneath the mod; every process.run call is recorded in `calls`, every debounce request in `timers`. */
function host(on: any, calls: string[][], timers: number[], enabled: boolean): void {
  resetCrew();
  resetEffort();
  resetSeams();
  setDagrStatus("");
  dagrReset({ id: "", cwd: "/Users/someone/projects/app" }, Date.now());
  const settings = { gate: { enabled: true, rules: [] }, dagr: { enabled, debounce_ms: 250 } };
  on("store.get", async (_$: any, e: any) => ({ value: e.key === "settings" ? settings : undefined }));
  on("store.set", async () => ({ value: undefined }));
  on("fs.read", async () => ({ deny: "no such file" }));
  on("session.cwd", async () => ({ value: "/Users/someone/projects/app" }));
  on("agent.spawn", async (_$: any, e: any) => ({ model: e.model ?? "haiku", agentId: "w1" }));
  on("turn.step", async function* (_$: any, e: any) {
    return { turnId: e.turnId, index: e.index, answer: "", toolUses: [] };
  });
  on("classic.SubagentStop", async () => ({ value: null }));
  on("clock.after", async (_$: any, e: any) => {
    if (e.ms === 250) timers.push(e.ms);
    return { value: undefined };
  });
  on("process.run", async (_$: any, e: any) => {
    if ((e.argv ?? []).includes("dagr-publish")) calls.push(e.argv);
    return { value: { exitCode: 0, stdout: "", stderr: "" } };
  });
}

async function crewRuns(ctx: any): Promise<void> {
  await ctx.agent.spawn({
    prompt: "HAIKREW job=impl lang=ts name=Kite\nDo it.", description: "do it", subagentType: "haiku-coder",
    parentModel: "opus", background: false, fork: false,
  });
  for await (const _ of ctx.turn.step({ turnId: "t", index: 0, model: "haiku", effort: "medium", messageCount: 1, agentId: "w1" })) { /* drain */ }
  await ctx.classic.SubagentStop({ agent_id: "w1", agent_type: "haiku-coder", agent_transcript_path: "" });
}

test("disabled does nothing", async (ctx: any, on: any) => {
  const calls: string[][] = [];
  const timers: number[] = [];
  host(on, calls, timers, false);
  await crewRuns(ctx);
  await wait(100);
  expect(timers.length).toBe(0);
  expect(calls.length).toBe(0);
});

test("a spawn and a stop ask for the debounce, and the run they build publishes as a valid one-task document", async (ctx: any, on: any) => {
  const calls: string[][] = [];
  const timers: number[] = [];
  host(on, calls, timers, true);
  await crewRuns(ctx);
  await wait(100);
  expect(timers.length).toBeGreaterThan(0);
  // The mod keeps its own exporter state, so the same observations are fed to this file's copy to build the document.
  const t = Date.now();
  dagrSpawn("w1", { name: "Kite", type: "haiku-coder", description: "do it", model: "haiku" }, t);
  dagrActivity("w1", t + 1, false);
  dagrStop("w1", t + 2, t + 2, { name: "Kite", type: "haiku-coder", model: "haiku", selfVerdict: "none", reviewRequested: false });
  const doc = dagrDocument(t + 3);
  expect(checkRun(doc)).toEqual([]);
  expect((doc as any).tasks.length).toBe(1);
  // The timer fired by hand: the publish runs `node <root>/scripts/haikrew.mjs dagr-publish <json>` in the session folder.
  const seen: { argv: string[]; cwd: string }[] = [];
  const io = { after: () => 0, root: "/p", run: async (argv: string[], o: { cwd: string }) => { seen.push({ argv, cwd: o.cwd }); return { exitCode: 0 }; } };
  expect(await dagrPublish(JSON.stringify(doc), io, "/Users/someone/projects/app", () => undefined)).toBeNull();
  expect(seen[0].argv.slice(0, 3)).toEqual(["node", "/p/scripts/haikrew.mjs", "dagr-publish"]);
  expect(checkRun(JSON.parse(seen[0].argv[3]))).toEqual([]);
  expect(seen[0].cwd).toBe("/Users/someone/projects/app");
});

test("on the desktop surface the first publish says so and later changes make no more process calls", async () => {
  setDagrStatus("");
  let timer: (() => void) | null = null;
  let runs = 0;
  const io = { after: (_ms: number, fn: () => void) => { timer = fn; return 0; }, root: "/p", run: async () => { runs += 1; throw new Error("no process runner"); } };
  dagrReset({ id: "", cwd: "/r" }, Date.now());
  const s: ReturnType<typeof makeScheduler> = makeScheduler({
    after: io.after, document: () => ({ dagr: 3 }), generation: dagrGeneration,
    publish: (json) => dagrPublish(json, io, "/r", () => s.disable()),
  });
  s.changed(250);
  (timer as unknown as () => void)();
  await wait(20);
  expect(dagrStatus()).toBe(NO_CLI);
  expect(runs).toBe(1);
  timer = null;
  s.changed(250);
  expect(timer).toBeNull();
  expect(runs).toBe(1);
});

test("the publish step caps the candidate and reports a missing runner", async () => {
  let off = 0;
  const big = "x".repeat(MAX_JSON + 1);
  expect(await dagrPublish(big, null, "/r", () => { off += 1; })).toMatch(/^run too large to publish \(\d+ KiB\)$/);
  const io = { after: () => 0, root: "/p", run: async () => { throw new Error("x"); } };
  expect(await dagrPublish("{}", io, "/r", () => { off += 1; })).toBe(NO_CLI);
  expect(off).toBe(1);
  const bad = { after: () => 0, root: "/p", run: async () => ({ exitCode: 2, stdout: "", stderr: "\nbad run\nmore" }) };
  expect(await dagrPublish("{}", bad, "/r", () => { off += 1; })).toBe("bad run");
});

test("an export switched on after session start begins its run at the next agent launch, once", async () => {
  const io = { after: () => undefined, run: async () => ({ exitCode: 0 }), root: "/x" };
  dagrReset({ id: "", cwd: "" }, 0); // as after a session start with the export off: no run
  expect(dagrActive()).toBe(false);
  dagrSession("s-later-123456");
  dagrEnsure(false, 250, io, "/repo");
  expect(dagrActive()).toBe(false);
  dagrEnsure(true, 250, io, "");
  expect(dagrActive()).toBe(false);
  dagrEnsure(true, 250, io, "/repo");
  expect(dagrActive()).toBe(true);
  const gen = dagrGeneration();
  dagrEnsure(true, 250, io, "/repo");
  expect(dagrGeneration()).toBe(gen);
});
