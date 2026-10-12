/** Review packet, test-claim reading, review notes, and the crew's record of what an agent changed. */
import { expect, test } from "claude-code/testing";
import { buildPacket, reviewNote, testsClaim } from "../../src/mod/packet.ts";
import { noteSpawn, noteToolCall, resetCrew, specOf, touched } from "../../src/mod/crew.ts";

const deep = { tier: "deep" as const, reviewer: { model: "opus", effort: "high" }, reasons: ["touches hooks/register.ts"] };
const light = { tier: "light" as const, reviewer: null, reasons: ["small change"] };

test("buildPacket carries who, tier, spec, report, files, test claim and the verdict instruction", () => {
  const p = buildPacket({ name: "Isaac Newline", type: "haiku-coder", model: "haiku", spec: "Do X\n```js\ncode\n```", report: "All done.",
    paths: ["a.ts", "b.ts"], lines: 40, testsPassed: true, plan: deep });
  expect(p).toContain("Isaac Newline");
  expect(p).toContain("Tier: deep (touches hooks/register.ts)");
  expect(p).toContain("Do X");
  expect(p).toContain("All done.");
  expect(p).toContain("- a.ts\n- b.ts");
  expect(p).toContain("~40 lines");
  expect(p).toContain("claims tests pass");
  expect(p).toContain("do not trust the report");
  expect(p).toContain("VERDICT: PASS for Isaac Newline");
  expect(p).toContain("VERDICT: FAIL for Isaac Newline");
  expect(p).toContain("````"); // the spec's own fence cannot close the packet's
});

test("testsClaim reads pass and fail claims", () => {
  expect(testsClaim("12 passed, 0 failed")).toBe(true);
  expect(testsClaim("VERDICT: PASS")).toBe(true);
  expect(testsClaim("3 pass 0 fail")).toBe(true);
  expect(testsClaim("10 passed, 2 failed")).toBe(false);
  expect(testsClaim("VERDICT: FAIL")).toBe(false);
  expect(testsClaim("I changed the file.")).toBe(null);
});

test("reviewNote words each tier", () => {
  const d = reviewNote("Isaac Newline", deep, ["a", "b", "c"], 140);
  expect(d).toContain("HaiKrew review: Isaac Newline finished (3 files, ~140 lines)");
  expect(d).toContain("Tier deep: touches hooks/register.ts");
  expect(d).toContain("opus at high effort");
  expect(d).toContain("HAIKREW job=review name=<a name>");
  expect(d).toContain('mcp__haikrew__review_packet with agent "Isaac Newline"');
  const l = reviewNote("Isaac Newline", light, ["a"], 3);
  expect(l).toContain("Tier light");
  expect(l).toContain("mcp__haikrew__record_verdict");
  expect(reviewNote("Isaac Newline", { tier: "none", reviewer: null, reasons: [] })).toBe("");
});

test("touched records files and line estimates from Edit, MultiEdit, Write and NotebookEdit; specOf keeps the prompt", () => {
  resetCrew();
  noteSpawn({ prompt: "p".repeat(5000) }, { agentId: "w1", model: "haiku" }, 0);
  expect(specOf("w1").length).toBe(4000);
  noteToolCall({ agentId: "w1", tool: "Edit", file_path: "/x/a.ts", new_string: "1\n2\n3" }, 1);
  noteToolCall({ agentId: "w1", tool: "MultiEdit", file_path: "/x/b.ts", edits: [{ new_string: "a" }, { new_string: "b\nc" }] }, 2);
  noteToolCall({ agentId: "w1", tool: "Write", file_path: "/x/a.ts", content: "1\n2" }, 3);
  noteToolCall({ agentId: "w1", tool: "NotebookEdit", notebook_path: "/x/n.ipynb" }, 4);
  noteToolCall({ agentId: "w1", tool: "Read", file_path: "/x/c.ts" }, 5);
  expect(touched("w1")).toEqual({ paths: ["/x/a.ts", "/x/b.ts", "/x/n.ipynb"], lines: 3 + 3 + 2 + 1 });
  expect(touched("nobody")).toEqual({ paths: [], lines: 0 });
});
