/** Hook wiring through the mounted mod: spawn gets model, instructions and effort; turn.step applies it; checks fire. */
import { expect, test } from "claude-code/testing";
import { resetCrew } from "../../src/mod/crew.ts";
import { leadNote } from "../../src/mod/delegate.ts";
import { resetEffort } from "../../src/mod/effort.ts";
import { resetHealth } from "../../src/mod/health.ts";
import { resetSeams } from "../../src/mod/seam.ts";

const SETTINGS = {
  gate: {
    enabled: true,
    rules: ["job:review=sonnet@high"],
    instructions: ["cwd:~/projects/*: never disable git hooks"],
  },
};

/** The engine beneath the mod: settings from a fixed store, a fixed session folder, spawns that echo back. */
function host(on: any, seen: Record<string, any>, chunks: unknown[] = [], settings: unknown = SETTINGS): void {
  resetCrew();
  resetEffort();
  resetSeams();
  on("store.get", async (_$: any, e: any) => ({ value: e.key === "settings" ? settings : undefined }));
  on("store.set", async () => ({ value: undefined }));
  on("fs.read", async () => ({ deny: "no such file" }));
  on("session.cwd", async () => ({ value: "/Users/someone/projects/app" }));
  on("agent.spawn", async (_$: any, e: any) => {
    seen.spawn = e;
    return { model: e.model ?? "haiku", agentId: "w1" };
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

test("review_packet returns the stored packet in any case, and names the agents that have one when none matches", async (ctx: any, on: any) => {
  const stored: Record<string, any> = {
    settings: { agents: { control: "read" } },
    review_packets: { "Marie Curl": "# Review packet: Marie Curl" },
  };
  on("store.get", async (_$: any, e: any) => ({ value: stored[e.key] }));
  on("store.set", async (_$: any, e: any) => { stored[e.key] = e.value; return { value: undefined }; });
  const hit = await ctx.tool.call({ tool: "mcp__haikrew__review_packet", agent: "marie curl" });
  expect(hit.result).toBe("# Review packet: Marie Curl");
  const miss = await ctx.tool.call({ tool: "mcp__haikrew__review_packet", agent: "Ada Lovelace" });
  expect(miss.result).toContain("Packets exist for: Marie Curl.");
  const refused = await ctx.tool.call({ tool: "mcp__haikrew__record_verdict", agent: "Marie Curl", verdict: "pass" });
  expect(JSON.stringify(refused)).toContain("read-only");
});

test("record_verdict writes the main agent's verdict to the named run, toasts it, and refuses a name with no run", async (ctx: any, on: any) => {
  const run = {
    ts: "2026-10-12T10:00:00.000Z", session: "s", agent_id: "w9", agent_type: "haiku-coder", model: "haiku", job: "implement",
    lang: "ts", duration_s: 40, tokens_in: 10, tokens_out: 5, cache_read: 0, cache_write: 0, tokens_estimated: false,
    tool_calls: 3, attempts: 1, verdict: "unjudged", quality: 0, name: "Marie Curl",
  };
  const stored: Record<string, any> = { settings: { agents: { control: "change" } }, ledger: { runs: [run], buckets: [] } };
  const toasts: unknown[] = [];
  on("store.get", async (_$: any, e: any) => ({ value: stored[e.key] }));
  on("store.set", async (_$: any, e: any) => { stored[e.key] = e.value; return { value: undefined }; });
  on("ui.toast", async (_$: any, e: any) => { toasts.push(e); return { value: undefined }; });
  on("ui.invalidate", async () => ({ value: undefined }));
  const ok = await ctx.tool.call({ tool: "mcp__haikrew__record_verdict", agent: "Marie Curl", verdict: "pass" });
  expect(ok.result).toBe("Recorded pass for Marie Curl.");
  expect(stored.ledger.runs[0].verdict).toBe("pass");
  expect(stored.ledger.runs[0].checked_by).toBe("main agent");
  expect(JSON.stringify(toasts)).toContain("HaiKrew: Marie Curl marked pass");
  const bad = await ctx.tool.call({ tool: "mcp__haikrew__record_verdict", agent: "Marie Curl", verdict: "maybe" });
  expect(JSON.stringify(bad)).toContain("The verdict is");
  const missing = await ctx.tool.call({ tool: "mcp__haikrew__record_verdict", agent: "Ada Lovelace", verdict: "fail" });
  expect(JSON.stringify(missing)).toContain("No finished agent named");
});

test("a stop after an edit under hooks/ tells the main conversation to review at Tier deep, and stores the packet", async (ctx: any, on: any) => {
  const seen: Record<string, any> = {};
  resetCrew();
  resetEffort();
  resetSeams();
  on("session.cwd", async () => ({ value: "/Users/someone/projects/app" }));
  on("agent.spawn", async (_$: any, e: any) => ({ model: e.model ?? "haiku", agentId: "w1" }));
  on("classic.SubagentStop", async () => ({ value: null }));
  on("tool.call", async () => ({ result: "ok" }));
  const stored: Record<string, any> = { settings: SETTINGS };
  const transcript = [
    { type: "user", timestamp: "2026-10-08T09:00:00.000Z", message: { content: "HAIKREW job=implement lang=ts name=Isaac_Newline\nedit it" } },
    { type: "assistant", timestamp: "2026-10-08T09:00:09.000Z", message: { id: "m1", model: "claude-haiku-5-5", usage: { input_tokens: 1, output_tokens: 1 },
      content: [{ type: "text", text: "Done. 5 passed, 0 failed." }] } },
  ].map((l) => JSON.stringify(l)).join("\n");
  on("store.get", async (_$: any, e: any) => ({ value: stored[e.key] }));
  on("store.set", async (_$: any, e: any) => { stored[e.key] = e.value; return { value: undefined }; });
  on("fs.read", async () => ({ value: transcript }));
  on("ui.invalidate", async () => ({ value: undefined }));
  on("session.append", async (_$: any, e: any, next: any) => { seen.append = e; return next(e); });
  const reply = await ctx.agent.spawn({
    prompt: "HAIKREW job=implement lang=ts name=Isaac_Newline\nedit it", description: "edit", subagentType: "haiku-coder",
    parentModel: "opus", background: false, fork: false,
  });
  await ctx.tool.call({ tool: "Edit", agentId: reply.agentId, file_path: "/repo/plugin/hooks/register.ts", new_string: "a\nb" });
  await ctx.classic.SubagentStop({ agent_id: reply.agentId, agent_type: "haiku-coder", agent_transcript_path: "/t.jsonl" });
  const text = seen.append.message.content[0].text;
  expect(text).toContain("Isaac Newline finished");
  expect(text).toContain("Tier deep");
  expect(stored.review_packets["Isaac Newline"]).toContain("hooks/register.ts");
});

/** A subagent transcript: its prompt as the first user line, then one final assistant text. */
function transcriptOf(prompt: string, text: string): string {
  return [
    { type: "user", timestamp: "2026-10-08T09:00:00.000Z", message: { content: prompt } },
    { type: "assistant", timestamp: "2026-10-08T09:00:09.000Z", message: { id: "m1", model: "claude-haiku-5-5", usage: { input_tokens: 1, output_tokens: 1 },
      content: [{ type: "text", text }] } },
  ].map((l) => JSON.stringify(l)).join("\n");
}

test("a checker's VERDICT line settles the run it names, and a job=check run gets no review of its own", async (ctx: any, on: any) => {
  resetCrew();
  resetEffort();
  resetSeams();
  on("session.cwd", async () => ({ value: "/Users/someone/projects/app" }));
  const ids = ["c1", "k1", "k2"];
  on("agent.spawn", async (_$: any, e: any) => ({ model: e.model ?? "haiku", agentId: ids.shift() }));
  on("classic.SubagentStop", async () => ({ value: null }));
  on("tool.call", async () => ({ result: "ok" }));
  const stored: Record<string, any> = { settings: SETTINGS };
  const transcripts: Record<string, string> = {
    "/coder.jsonl": transcriptOf("HAIKREW job=implement lang=ts name=Isaac_Newline\nedit it", "Done."),
    "/checker.jsonl": transcriptOf("HAIKREW job=check name=Karl_Checker\ncheck it",
      "SPEC   1/1 met — missing: none\nTESTS  verify: PASS (5 passed)\nBROKE  none\nRISK   none\nVERDICT: PASS for Isaac Newline"),
    "/checker2.jsonl": transcriptOf("HAIKREW job=check name=Karl_Checker\ncheck again", "Stopped early: no verdict."),
  };
  const appended: any[] = [];
  on("store.get", async (_$: any, e: any) => ({ value: stored[e.key] }));
  on("store.set", async (_$: any, e: any) => { stored[e.key] = e.value; return { value: undefined }; });
  on("fs.read", async (_$: any, e: any) => ({ value: transcripts[e.path] }));
  on("ui.invalidate", async () => ({ value: undefined }));
  on("session.append", async (_$: any, e: any, next: any) => { appended.push(e); return next(e); });
  const coder = await ctx.agent.spawn({
    prompt: "HAIKREW job=implement lang=ts name=Isaac_Newline\nedit it", description: "edit", subagentType: "haiku-coder",
    parentModel: "opus", background: false, fork: false,
  });
  await ctx.tool.call({ tool: "Edit", agentId: coder.agentId, file_path: "/repo/src/mod/a.ts", new_string: "a\nb" });
  await ctx.classic.SubagentStop({ agent_id: coder.agentId, agent_type: "haiku-coder", agent_transcript_path: "/coder.jsonl" });
  expect(appended.length).toBe(1);
  const checker = await ctx.agent.spawn({
    prompt: "HAIKREW job=check name=Karl_Checker\ncheck it", description: "check", subagentType: "haikrew:haiku-checker",
    parentModel: "opus", background: false, fork: false,
  });
  await ctx.tool.call({ tool: "Edit", agentId: checker.agentId, file_path: "/repo/plugin/hooks/register.ts", new_string: "a\nb" });
  await ctx.classic.SubagentStop({ agent_id: checker.agentId, agent_type: "haikrew:haiku-checker", agent_transcript_path: "/checker.jsonl" });
  expect(appended.length).toBe(1);
  const again = await ctx.agent.spawn({
    prompt: "HAIKREW job=check name=Karl_Checker\ncheck again", description: "check", subagentType: "haikrew:haiku-checker",
    parentModel: "opus", background: false, fork: false,
  });
  await ctx.tool.call({ tool: "Edit", agentId: again.agentId, file_path: "/repo/plugin/hooks/register.ts", new_string: "a\nb" });
  await ctx.classic.SubagentStop({ agent_id: again.agentId, agent_type: "haikrew:haiku-checker", agent_transcript_path: "/checker2.jsonl" });
  expect(appended.length).toBe(1);
  const run = stored.ledger.runs.find((r: any) => r.name === "Isaac Newline");
  expect([run.verdict, run.checked_by]).toEqual(["pass", "Karl Checker"]);
});

test("a slow decider health check does not hold up a spawn, and a decider known to be down is skipped", async (ctx: any, on: any) => {
  resetHealth();
  const seen: Record<string, any> = { asks: 0, healthCalls: 0 };
  let openHealth!: (ok: boolean) => void;
  const healthGate = new Promise<boolean>((resolve) => { openHealth = resolve; });
  const decider = { mode: "decide", url: "http://decider.test", explore_rate: 0 };
  host(on, seen, [], { ...SETTINGS, decider });
  on("http.fetch", async (_$: any, e: any) => {
    if (String(e.url).endsWith("/health")) {
      seen.healthCalls += 1;
      return { value: { ok: await healthGate, status: 200, headers: {}, text: "" } };
    }
    seen.asks += 1;
    const answer = { answers: { model: { choice: "sonnet", confidence: 0.9, probabilities: { haiku: 0.1, sonnet: 0.9 } } } };
    return { value: { ok: true, status: 200, headers: {}, text: JSON.stringify(answer) } };
  });
  const prompt = { prompt: "Fix the parser.", description: "fix", subagentType: "general-purpose", parentModel: "opus", background: false, fork: false };
  const started = Date.now();
  await ctx.agent.spawn(prompt);
  expect(Date.now() - started).toBeLessThan(1000); // the health check is still pending, and far slower than the spawn
  expect(seen.healthCalls).toBe(1);
  expect(seen.spawn.model).toBe("sonnet"); // unknown status: the decider is tried
  expect(seen.asks).toBe(1);
  openHealth(false);
  await new Promise((resolve) => setTimeout(resolve, 20));
  await ctx.agent.spawn(prompt);
  expect(seen.spawn.model).toBe("haiku"); // known offline: the gate's default stands and no decider call is made
  expect(seen.asks).toBe(1);
  resetHealth();
});

/** The lead note's opening line, as the spawn prompt carries it when it has one. */
const LEAD = "# HaiKrew: you lead a Haiku crew";
const IMPLEMENT = "HAIKREW job=implement lang=ts name=Ada\nedit it";

test("a Sonnet implement spawn's prompt gets the lead note, once", async (ctx: any, on: any) => {
  const seen: Record<string, any> = {};
  host(on, seen, [], { gate: { enabled: true, rules: ["job:implement=sonnet"] } });
  await ctx.agent.spawn({ prompt: IMPLEMENT, description: "d", subagentType: "general-purpose", parentModel: "opus", background: false, fork: false });
  expect(seen.spawn.model).toBe("sonnet");
  expect(seen.spawn.prompt.split(LEAD).length - 1).toBe(1);
  expect(seen.spawn.prompt.endsWith("- Run independent pieces in parallel.")).toBe(true);
});

test("a Haiku implement spawn gets no lead note", async (ctx: any, on: any) => {
  const seen: Record<string, any> = {};
  host(on, seen, [], { gate: { enabled: true, rules: ["job:implement=sonnet"] } });
  await ctx.agent.spawn({ prompt: IMPLEMENT, description: "d", subagentType: "general-purpose", parentModel: "opus", background: false, fork: false, model: "haiku" });
  expect(seen.spawn.model).toBe("haiku");
  expect(seen.spawn.prompt).not.toContain(LEAD);
});

test("a Sonnet review spawn gets no lead note", async (ctx: any, on: any) => {
  const seen: Record<string, any> = {};
  host(on, seen);
  await ctx.agent.spawn({ prompt: "HAIKREW job=review lang=ts\nReview it.", description: "review", subagentType: "general-purpose", parentModel: "opus", background: false, fork: false });
  expect(seen.spawn.model).toBe("sonnet");
  expect(seen.spawn.prompt).not.toContain(LEAD);
});

test("no lead note when nesting is off", async (ctx: any, on: any) => {
  const seen: Record<string, any> = {};
  host(on, seen, [], { gate: { enabled: true, rules: ["job:implement=sonnet"], allow_nested: false } });
  await ctx.agent.spawn({ prompt: IMPLEMENT, description: "d", subagentType: "general-purpose", parentModel: "opus", background: false, fork: false });
  expect(seen.spawn.model).toBe("sonnet");
  expect(seen.spawn.prompt).not.toContain(LEAD);
});

test("a prompt that already carries the lead note is not given a second copy", async (ctx: any, on: any) => {
  const seen: Record<string, any> = {};
  host(on, seen, [], { gate: { enabled: true, rules: ["job:implement=sonnet"] } });
  const once = `${IMPLEMENT}\n\n${leadNote({ enabled: true, delegate: true, allow_nested: true } as any)}`;
  await ctx.agent.spawn({ prompt: once, description: "d", subagentType: "general-purpose", parentModel: "opus", background: false, fork: false });
  expect(seen.spawn.prompt.split(LEAD).length - 1).toBe(1);
});
