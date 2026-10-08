/** Pane checks: the command opens the pane, each tab draws, a bool saves, a bad int is refused, the empty ledger shows. */
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
  expect(await drawnText(m)).toContain("No agents working.");
  await m.press({ key: "tab-settings" });
  expect(await drawnText(m)).toContain("Agent model gate");
  await m.press({ key: "tab-ledger" });
  expect(await drawnText(m)).toContain("No agent runs recorded yet. Runs are added when a subagent finishes.");
  await m.press({ key: "tab-tokens" });
  expect(await drawnText(m)).toContain("This session");
});

test("toggling a bool saves it", async (ctx: any, on: any) => {
  const h = host(on);
  const m = await open(ctx);
  await m.press({ key: "tab-settings" });
  await m.press({ key: "gate.enabled" });
  expect((h.store.get("settings") as { gate: { enabled: boolean } }).gate.enabled).toBe(false);
});

test("an invalid int shows its error and does not save", async (ctx: any, on: any) => {
  const h = host(on);
  const m = await open(ctx);
  await m.press({ key: "tab-settings" });
  await m.select({ key: "section", value: "read_guard" });
  await m.input({ key: "read_guard.max_lines", text: "5", submit: true });
  expect(await drawnText(m)).toContain("must be between 100 and 20000");
  expect(h.store.has("settings")).toBe(false);
});
