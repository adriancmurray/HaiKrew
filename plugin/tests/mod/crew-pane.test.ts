/** Crew tab checks on the mounted pane: both surfaces draw, the hooks feed the roster, and the empty state shows. */
import { expect, test } from "claude-code/testing";
import { resetCrew } from "../../src/mod/crew.ts";
import { pickName } from "../../src/mod/names.ts";


/** Answers the host reads the pane makes. Nothing touches the disk. */
function host(on: any): void {
  on("fs.read", async () => ({ deny: "no such file" }));
  on("store.get", async () => ({ value: undefined }));
  on("ui.open", async () => ({ value: null }));
  on("classic.SubagentStop", async () => ({ value: null }));
}

/** Runs /haikrew and mounts its pane on the given surface. */
async function open(ctx: any, surface: string): Promise<any> {
  await ctx.command.run({ command: "haikrew" });
  return ctx.ui.mount({
    plugin: "haikrew", surface, component: "Pane", props: { bodyColumns: 80 },
    requestId: "haikrew", viewport: { columns: 80, rows: 40 },
  });
}

async function drawnText(m: any): Promise<string> {
  return JSON.stringify(await m.drawn({}));
}

test("the empty Crew tab shows the sleeping lead's message on the terminal", async (ctx: any, on: any) => {
  host(on);
  resetCrew();
  const m = await open(ctx, "terminal");
  const text = await drawnText(m);
  expect(text).toContain("No agents working.");
  expect(text).toContain("Crew members appear here when Claude starts a subagent.");
});

test("the Crew tab draws on the desktop surface as an SVG scene", async (ctx: any, on: any) => {
  host(on);
  resetCrew();
  const m = await open(ctx, "desktop");
  const text = await drawnText(m);
  expect(text).toContain("<svg");
  expect(text).toContain("Nobody is working right now.");
});

test("a SubagentStop puts its agent on the roster", async (ctx: any, on: any) => {
  host(on);
  resetCrew();
  await ctx.classic.SubagentStop({ agent_id: "crew-h1", agent_type: "Explore", agent_transcript_path: "" });
  const text = await drawnText(await open(ctx, "terminal"));
  expect(text).toContain(pickName("crew-h1", new Set()));
  expect(text).not.toContain("No agents working.");
});
