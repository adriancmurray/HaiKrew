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
function host(on: any, seen: Record<string, any>): void {
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

test("a git hook bypass is refused before it runs", async (ctx: any, on: any) => {
  host(on, {});
  on("tool.call", async () => ({ value: "ran" }));
  const out = await ctx.tool.call({ tool: "Bash", command: "git commit --no-verify -m x" });
  expect(JSON.stringify(out)).toContain("skip git hooks");
});
