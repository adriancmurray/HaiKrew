/**
 * Pane checks: the command opens the pane, each tab draws, the header switch and a bool save, a bad int is refused,
 * list entries are added, moved and removed (twice pressed), and the ledger shows its per-model rows.
 */
import { test, expect } from "claude-code/testing";

type Host = { store: Map<string, unknown>; opened: string[] };

/** Answers the host events the pane reads and writes, from in-memory state. Settings live in the mod store. */
function host(on: any): Host {
  const h: Host = { store: new Map(), opened: [] };
  on("store.get", async (_$: unknown, e: { key: string }) => ({ value: h.store.get(e.key) }));
  on("store.set", async (_$: unknown, e: { key: string; value: unknown }) => {
    h.store.set(e.key, e.value);
    return { value: undefined };
  });
  on("ui.open", async (_$: unknown, e: { id: string }) => {
    h.opened.push(e.id);
    return { value: null };
  });
  on("session.usage", async () => ({
    value: { context: { tokens: 1234, window: 200000, percent: 1 }, rateLimits: [] },
  }));
  return h;
}

/** Runs /haikrew and mounts its pane on a terminal surface. */
async function open(ctx: any): Promise<any> {
  await ctx.command.run({ command: "haikrew" });
  return ctx.ui.mount({
    plugin: "haikrew", surface: "terminal", component: "Pane", props: { bodyColumns: 80 },
    requestId: "haikrew", viewport: { columns: 80, rows: 40 },
  });
}

async function drawnText(m: any): Promise<string> {
  return JSON.stringify(await m.drawn({}));
}

test("the /haikrew command opens the pane", async (ctx: any, on: any) => {
  const h = host(on);
  await ctx.command.run({ command: "haikrew" });
  expect(h.opened).toEqual(["haikrew"]);
});

test("each tab draws on the terminal surface", async (ctx: any, on: any) => {
  host(on);
  const m = await open(ctx);
  await m.press({ key: "tab-home" });
  const home = await drawnText(m);
  expect(home).toContain("No agents working.");
  expect(home).toContain("This session");
  await m.press({ key: "tab-settings" });
  expect(await drawnText(m)).toContain("Agent model gate");
  await m.press({ key: "tab-ledger" });
  expect(await drawnText(m)).toContain("No runs recorded yet.");
});

test("toggling a bool saves it", async (ctx: any, on: any) => {
  const h = host(on);
  const m = await open(ctx);
  await m.press({ key: "tab-settings" });
  await m.press({ key: "gate.enabled-on" });
  expect((h.store.get("settings") as { gate: { enabled: boolean } }).gate.enabled).toBe(true);
});

test("the header switch turns the gate on from any tab", async (ctx: any, on: any) => {
  const h = host(on);
  const m = await open(ctx);
  expect(await drawnText(m)).toContain("subagents run on whatever model they ask for");
  await m.press({ key: "gate-switch-on" });
  expect((h.store.get("settings") as { gate: { enabled: boolean } }).gate.enabled).toBe(true);
  expect(await drawnText(m)).toContain("applies to every session");
});

test("a rule is built from the form, moved up, and removed only on the second press", async (ctx: any, on: any) => {
  const h = host(on);
  const rules = (): string[] => (h.store.get("settings") as { gate: { rules: string[] } }).gate.rules;
  const m = await open(ctx);
  await m.press({ key: "tab-settings" });
  await m.press({ key: "group-routing" });
  await m.press({ key: "gate.rules-add" });
  expect(await drawnText(m)).toContain("Fill in what the rule matches first.");
  await m.select({ key: "gate.rules-kind", value: "desc" });
  await m.input({ key: "gate.rules-value", text: "a=b", submit: true });
  await m.press({ key: "gate.rules-add" });
  expect(await drawnText(m)).toContain("does not match");
  expect(h.store.has("settings")).toBe(false);
  await m.input({ key: "gate.rules-value", text: "migration", submit: true });
  await m.press({ key: "gate.rules-model-sonnet" });
  await m.press({ key: "gate.rules-add" });
  expect(rules()).toEqual(["job:review=sonnet", "job:research=haiku", "type:Explore=haiku", "desc:migration=sonnet"]);
  expect(await drawnText(m)).toContain("task mentions migration");
  await m.press({ key: "gate.rules-up-3" });
  expect(rules()[2]).toBe("desc:migration=sonnet");
  await m.press({ key: "gate.rules-rm-0" });
  expect(rules()).toHaveLength(4);
  expect(await drawnText(m)).toContain("Remove?");
  await m.press({ key: "gate.rules-rm-0" });
  expect(rules()).toEqual(["job:research=haiku", "desc:migration=sonnet", "type:Explore=haiku"]);
});

test("effort per model and squeeze tools are buttons, stored in the old formats", async (ctx: any, on: any) => {
  const h = host(on);
  const settings = (): any => h.store.get("settings");
  const m = await open(ctx);
  await m.press({ key: "tab-settings" });
  await m.press({ key: "group-routing" });
  await m.press({ key: "gate.default_effort-sonnet-high" });
  expect(settings().gate.default_effort).toEqual(["sonnet=high"]);
  await m.press({ key: "gate.default_effort-sonnet-own" });
  expect(settings().gate.default_effort).toEqual([]);
  await m.press({ key: "group-guards" });
  await m.press({ key: "squeeze.patterns-preset-6-off" });
  expect(settings().squeeze.patterns).not.toContain("^make\\b");
  expect(settings().squeeze.patterns).toHaveLength(6);
});

test("the pane opens itself at session start only when that setting is on", async (ctx: any, on: any) => {
  const h = host(on);
  on("session.start", async (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }));
  on("command.register", async () => ({ value: undefined }));
  await ctx.session.start({ cwd: "/tmp" });
  expect(h.opened).toEqual([]);
  h.store.set("settings", { pane: { open_on_start: true } });
  await ctx.session.start({ cwd: "/tmp" });
  expect(h.opened).toEqual(["haikrew"]);
});

test("the ledger leads with one row per model", async (ctx: any, on: any) => {
  const h = host(on);
  const run = (verdict: string) => ({ ts: "2026-10-12T14:02:00Z", session: "s", agent_id: "a", agent_type: "haiku-coder",
    model: "claude-haiku-5-5", job: "implement", lang: "ts", duration_s: 72, tokens_in: 9000, tokens_out: 1000,
    cache_read: 0, tool_calls: 3, attempts: 1, verdict, quality: verdict === "pass" ? 1 : 0 });
  h.store.set("ledger", { runs: [run("pass"), run("pass"), run("pass"), run("fail")], buckets: [] });
  const m = await open(ctx);
  await m.press({ key: "tab-ledger" });
  const text = await drawnText(m);
  expect(text).toContain("Haiku 5.5");
  expect(text).toContain("75%");
  expect(text).toContain("1m 12s");
  expect(text).toContain("10k");
});

test("an invalid int shows its error and does not save", async (ctx: any, on: any) => {
  const h = host(on);
  const m = await open(ctx);
  await m.press({ key: "tab-settings" });
  await m.press({ key: "group-guards" });
  await m.input({ key: "read_guard.max_lines", text: "5", submit: true });
  expect(await drawnText(m)).toContain("must be between 100 and 20000");
  expect(h.store.has("settings")).toBe(false);
});

test("a suggested rule is added only on the second press", async (ctx: any, on: any) => {
  const h = host(on);
  const failing = { period: "2026-10", model: "claude-haiku-5-5", agent_type: "haiku-coder", job: "implement",
    lang: "rust", n: 4, sum_quality: 0, sumsq_quality: 0, sum_tokens_in: 0, sum_tokens_out: 0, sum_duration: 0, passes: 0, fails: 4, sum_cache_read: 0 };
  h.store.set("ledger", { runs: [], buckets: [failing] });
  const m = await open(ctx);
  await m.press({ key: "tab-ledger" });
  const text = await drawnText(m);
  expect(text).toContain("implement rust on Haiku passed 0% of 4 judged runs");
  expect(text).toContain("When job is implement and language is rust → Sonnet");
  await m.press({ key: "suggest-0" });
  expect(await drawnText(m)).toContain("Press again to add");
  expect(h.store.has("settings")).toBe(false);
  await m.press({ key: "suggest-0" });
  const rules = (h.store.get("settings") as { gate: { rules: string[] } }).gate.rules;
  expect(rules[0]).toBe("job:implement+lang:rust=sonnet");
});

test("the desktop draws one page: banner, controls, crew, tokens, track record and settings", async (ctx: any, on: any) => {
  const h = host(on);
  const run = { ts: "2026-10-12T14:02:00Z", session: "s", agent_id: "a", agent_type: "haiku-coder", model: "claude-haiku-5-5",
    job: "implement", lang: "ts", duration_s: 72, tokens_in: 9000, tokens_out: 1000, cache_read: 0, tool_calls: 3, attempts: 1,
    verdict: "pass", quality: 1 };
  h.store.set("ledger", { runs: [run], buckets: [] });
  await ctx.command.run({ command: "haikrew" });
  const m = await ctx.ui.mount({ plugin: "haikrew", surface: "desktop", component: "Pane", props: { bodyColumns: 49, scroll: { offset: 0, bodyRows: 41 } },
    requestId: "haikrew", viewport: { columns: 70, rows: 47 } });
  const page = await drawnText(m);
  for (const part of ["<svg", "Controls", "Your crew", "Token use", "Track record", "Settings", "Haiku 5.5 passed 100% of 1", "Context"]) {
    expect(page).toContain(part);
  }
  await m.press({ key: "quick-model-sonnet" });
  expect((h.store.get("settings") as any).gate.default_model).toBe("sonnet");
  expect(page).not.toContain("Routing rules");
  await m.press({ key: "card-settings-toggle" });
  await m.press({ key: "group-routing" });
  expect(await drawnText(m)).toContain("Routing rules");
  await m.press({ key: "card-tokens-toggle" });
  expect(await drawnText(m)).toContain("Context 1%");
});

test("on the desktop the crew sits in the band above the prompt, unless turned off or a survey holds it", async (ctx: any, on: any) => {
  const h = host(on);
  let n = 0;
  const band = (props: Record<string, unknown> = {}) => ctx.ui.mount({ plugin: "haikrew", surface: "desktop", component: "AbovePrompt",
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 60, scroll: { offset: 0, bodyRows: 10 }, view: {}, ...props },
    requestId: `above-prompt-${++n}`, viewport: { columns: 70, rows: 47 } });
  const shown = await band();
  expect(JSON.stringify(await shown.drawn({}))).toContain("<svg");
  await shown.press({ key: "band-open" });
  expect(h.opened).toContain("haikrew");
  // Turned off, HaiKrew passes the band on; with nothing beneath it in a test, the mount then has no drawing.
  h.store.set("settings", { band: { show: false } });
  let passed = "";
  try {
    await band();
  } catch (error) {
    passed = String(error);
  }
  expect(passed).toContain("no implementation for ui.render");
});

test("agent tools refuse while off, read when allowed, and never touch agent control or Allow Opus", async (ctx: any, on: any) => {
  const h = host(on);
  on("tool.register", async () => ({ value: { tool: "x" } }));
  on("ui.toast", async () => ({ value: undefined }));
  const call = (name: string, args: Record<string, unknown> = {}) => ctx.tool.call({ tool: `mcp__haikrew__${name}`, ...args });
  expect(JSON.stringify(await call("status"))).toContain("Agent control is off");
  h.store.set("settings", { agents: { control: "read" } });
  expect(JSON.stringify(await call("status"))).toContain("default_model");
  expect(JSON.stringify(await call("set_setting", { section: "gate", key: "default_model", value: "sonnet" }))).toContain("read-only");
  h.store.set("settings", { agents: { control: "change" } });
  expect(JSON.stringify(await call("set_setting", { section: "agents", key: "control", value: "off" }))).toContain("cannot change");
  expect(JSON.stringify(await call("set_setting", { section: "gate", key: "allow_opus", value: true }))).toContain("Only the person");
  await call("set_setting", { section: "gate", key: "default_model", value: "sonnet" });
  expect((h.store.get("settings") as any).gate.default_model).toBe("sonnet");
  await call("add_rule", { conditions: [{ kind: "job", value: "migrate" }], model: "sonnet", first: true });
  expect((h.store.get("settings") as any).gate.rules[0]).toBe("job:migrate=sonnet");
  await call("remove_rule", { rule: "job:migrate=sonnet" });
  expect((h.store.get("settings") as any).gate.rules).not.toContain("job:migrate=sonnet");
});

test("a failed Haiku agent offers a retry on Sonnet that asks the main conversation", async (ctx: any, on: any) => {
  host(on);
  const asked: string[] = [];
  const line = (o: unknown) => JSON.stringify(o);
  const transcript = [line({ type: "user", timestamp: "2026-10-12T10:00:00.000Z", message: { content: "HAIKREW job=implement lang=ts\nAdd the parser" } }),
    line({ type: "assistant", timestamp: "2026-10-12T10:01:00.000Z", message: { id: "m1", model: "claude-haiku-5-5", content: [{ type: "text", text: "VERDICT: FAIL" }] } })].join("\n");
  on("fs.read", async () => ({ value: transcript }));
  on("prompt.submit", async (_$: unknown, e: { text: string }) => {
    asked.push(e.text);
    return { text: e.text };
  });
  on("ui.toast", async () => ({ value: undefined }));
  on("classic.SubagentStop", async () => ({ value: null }));
  await ctx.classic.SubagentStop({ agent_id: "f1", agent_type: "haiku-coder", agent_transcript_path: "/transcripts/f1.jsonl" });
  await ctx.command.run({ command: "haikrew" });
  const m = await ctx.ui.mount({ plugin: "haikrew", surface: "desktop", component: "Pane", props: { bodyColumns: 49 },
    requestId: "haikrew", viewport: { columns: 70, rows: 47 } });
  expect(await drawnText(m)).toContain("Retry on Sonnet");
  await m.press({ key: "retry-f1" });
  expect(asked).toHaveLength(1);
  expect(asked[0]).toContain("with model sonnet");
  expect(asked[0]).toContain("haiku-coder");
  expect(await drawnText(m)).toContain("Asked Claude to run it again on Sonnet.");
});
