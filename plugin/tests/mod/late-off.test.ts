/** The Insights card says once that late-failure detection is off when neither the CLI nor the session hook gave a path. */
import { expect, test } from "claude-code/testing";
import { LATE_OFF_TEXT } from "../../src/mod/late-file.ts";

function host(on: any): void {
  const store = new Map<string, unknown>();
  on("store.get", async (_$: unknown, e: { key: string }) => ({ value: store.get(e.key) }));
  on("store.set", async (_$: unknown, e: { key: string; value: unknown }) => { store.set(e.key, e.value); return { value: undefined }; });
  on("ui.open", async () => ({ value: null }));
  on("session.usage", async () => ({ value: { context: { tokens: 1, window: 200000, percent: 0 }, rateLimits: [] } }));
}

async function page(ctx: any): Promise<string> {
  await ctx.command.run({ command: "haikrew" });
  const m = await ctx.ui.mount({ plugin: "haikrew", surface: "desktop", component: "Pane", props: { bodyColumns: 49, scroll: { offset: 0, bodyRows: 41 } },
    requestId: "haikrew", viewport: { columns: 70, rows: 47 } });
  // Another test in the process may have collapsed the card: open it so its lines are drawn.
  if (JSON.stringify(await m.drawn({})).includes('"key":"card-insights-toggle","label":"▸"')) await m.press({ key: "card-insights-toggle" });
  return JSON.stringify(await m.drawn({}));
}

test("without a process runner or a flags file the Insights card says late-failure detection is off", async (ctx: any, on: any) => {
  host(on);
  on("env.get", async () => ({ value: "/h" }));
  on("process.run", async () => ({ deny: "CLI only" }));
  on("fs.read", async (_$: any, e: any) => ({ deny: "no such file" }));
  on("agent.spawn", async (_$: any, e: any) => ({ model: "haiku", agentId: "o1" }));
  on("session.cwd", async () => ({ value: "/r" }));
  await ctx.agent.spawn({ prompt: "HAIKREW job=implement lang=ts name=Ada\nedit", description: "d", subagentType: "haiku-coder", parentModel: "opus", background: false, fork: false });
  await new Promise((r) => setTimeout(r, 50));
  expect(await page(ctx)).toContain(LATE_OFF_TEXT);
});
