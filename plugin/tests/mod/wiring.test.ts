/** Hook wiring through the mounted mod: spawn gets model, instructions and effort; turn.step applies it; checks fire. */
import { expect, test } from "claude-code/testing";
import { resetCrew } from "../../src/mod/crew.ts";
import { resetEffort } from "../../src/mod/effort.ts";
import { resetSeams } from "../../src/mod/seam.ts";

const SETTINGS = {
  gate: {
    enabled: true,
    rules: ["job:review=sonnet@high"],
    instructions: ["cwd:~/projects/*: never disable git hooks"],
  },
};

/** The engine beneath the mod: settings from a fixed store, a fixed session folder, spawns that echo back. */
function host(on: any, seen: Record<string, any>, chunks: unknown[] = []): void {
  resetCrew();
  resetEffort();
  resetSeams();
  on("store.get", async (_$: any, e: any) => ({ value: e.key === "settings" ? SETTINGS : undefined }));
  on("store.set", async () => ({ value: undefined }));
  on("fs.read", async () => ({ deny: "no such file" }));
  on("session.cwd", async () => ({ value: "/Users/someone/projects/app" }));
  on("agent.spawn", async (_$: any, e: any) => {
    seen.spawn = e;
    return { model: e.model, agentId: "w1" };
  });
  on("turn.step", async function* (_$: any, e: any) {
    seen.step = e;
    for (const c of chunks) yield c;
    return { turnId: e.turnId, index: e.index, answer: "", toolUses: [] };
  });
  on("classic.SubagentStop", async () => ({ value: null }));
}

test("a matching spawn gets the rule's model, the instructions, and its effort on its own steps only", async (ctx: any, on: any) => {
  const seen: Record<string, any> = {};
  host(on, seen);
  const reply = await ctx.agent.spawn({
    prompt: "HAIKREW job=review lang=ts\nReview it.", description: "review", subagentType: "general-purpose",
    parentModel: "opus", background: false, fork: false,
  });
  expect(seen.spawn.model).toBe("sonnet");
  expect(seen.spawn.prompt).toContain("Instructions from HaiKrew settings:\n- never disable git hooks");
  const id = reply.agentId;
  for await (const _ of ctx.turn.step({ turnId: "t", index: 0, model: "sonnet", effort: "medium", messageCount: 1, agentId: id })) { /* drain */ }
  expect(seen.step.effort).toBe("high");
  for await (const _ of ctx.turn.step({ turnId: "m", index: 0, model: "opus", effort: "medium", messageCount: 1 })) { /* drain */ }
  expect(seen.step.effort).toBe("medium");
});

/** Runs a turn.step stream to its end: the chunks it yielded, in order, and the result it returned. */
async function drain(stream: AsyncGenerator<any, any>): Promise<{ chunks: any[]; result: any }> {
  const chunks: any[] = [];
  let step = await stream.next();
  while (!step.done) {
    chunks.push(step.value);
    step = await stream.next();
  }
  return { chunks, result: step.value };
}

test("the main loop's chunks pass through unchanged and in order, the band redraws as the lead's activity changes, and the step still returns its result", async (ctx: any, on: any) => {
  const chunks = [
    { kind: "thinking", index: 0, text: "Hmm." },
    { kind: "text", index: 1, text: "Hi" },
    { kind: "tool", index: 2, id: "u1", name: "Bash" },
  ];
  const seen: Record<string, any> = { invalidations: 0 };
  host(on, seen, chunks);
  on("ui.invalidate", async () => {
    seen.invalidations += 1;
    return { value: undefined };
  });
  const main = await drain(ctx.turn.step({ turnId: "m", index: 0, model: "opus", effort: "medium", messageCount: 1 }));
  expect(main.chunks).toEqual(chunks);
  expect(main.result).toEqual({ turnId: "m", index: 0, answer: "", toolUses: [] });
  // One redraw for the main step starting, then one each for thinking, writing and running.
  expect(seen.invalidations).toBe(4);
  const sub = await drain(ctx.turn.step({ turnId: "s", index: 0, model: "haiku", effort: "low", messageCount: 1, agentId: "w1" }));
  expect(sub.chunks).toEqual(chunks);
  expect(sub.result).toEqual({ turnId: "s", index: 0, answer: "", toolUses: [] });
  expect(seen.invalidations).toBe(4);
});

test("a git hook bypass is refused before it runs", async (ctx: any, on: any) => {
  host(on, {});
  on("tool.call", async () => ({ value: "ran" }));
  const out = await ctx.tool.call({ tool: "Bash", command: "git commit --no-verify -m x" });
  expect(JSON.stringify(out)).toContain("skip git hooks");
});

test("with the gate on, the main conversation's CLAUDE.md text carries the delegation note; subagents' does not", async (ctx: any, on: any) => {
  const seen: Record<string, any> = {};
  host(on, seen);
  on("prompt.context", async (_$: any, e: any) => { seen.context = e; return e; });
  await ctx.prompt.context({ blocks: [{ name: "claudeMd", text: "Mine." }] });
  const text = seen.context.blocks[0].text;
  expect(text.startsWith("Mine.\n\n# HaiKrew: delegate to the crew")).toBe(true);
  expect(text).toContain("`job:review=sonnet@high`");
  await ctx.prompt.context({ blocks: [{ name: "claudeMd", text: "Mine." }], agentId: "w1" });
  expect(seen.context.blocks[0].text).toBe("Mine.");
});

test("every agent tool answers with text, the shape a tool.call result must have", async (ctx: any, on: any) => {
  const stored: Record<string, any> = { settings: { agents: { control: "change" }, gate: { rules: ["job:review=sonnet"] } } };
  on("store.get", async (_$: any, e: any) => ({ value: stored[e.key] }));
  on("store.set", async (_$: any, e: any) => { stored[e.key] = e.value; return { value: undefined }; });
  on("ui.toast", async () => ({ value: undefined }));
  on("ui.invalidate", async () => ({ value: undefined }));
  const calls: [string, Record<string, unknown>][] = [
    ["status", {}],
    ["set_setting", { section: "gate", key: "default_model", value: "sonnet" }],
    ["add_rule", { conditions: [{ kind: "job", value: "docs" }], model: "haiku" }],
    ["remove_rule", { rule: "job:review=sonnet" }],
  ];
  for (const [name, input] of calls) {
    const out = await ctx.tool.call({ tool: `mcp__haikrew__${name}`, ...input });
    const result = out?.result ?? out;
    expect(typeof result).toBe("string");
  }
  expect(JSON.parse((await ctx.tool.call({ tool: "mcp__haikrew__status" })).result ?? "{}").settings.gate.default_model).toBe("sonnet");
  expect(stored.settings.gate.rules).toEqual(["job:docs=haiku"]);
});
