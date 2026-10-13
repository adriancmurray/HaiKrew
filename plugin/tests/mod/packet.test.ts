/** Review packet, test-claim reading, review notes, and the crew's record of what an agent changed. */
import { expect, test } from "claude-code/testing";
import { buildPacket, reviewNote, testsClaim } from "../../src/mod/packet.ts";
import { noteSpawn, noteToolCall, resetCrew, specOf, touched } from "../../src/mod/crew.ts";

const deep = { tier: "deep" as const, reviewer: { model: "opus", effort: "high" }, reasons: ["touches hooks/register.ts"] };
const light = { tier: "light" as const, reviewer: null, reasons: ["small change"] };
const checked = { tier: "light" as const, reviewer: { model: "haiku", effort: "medium", agent: "haikrew:haiku-checker" }, reasons: ["only light paths changed, 3 lines"] };
const inline = { tier: "deep" as const, reviewer: "inline" as const, reasons: ["touches hooks/register.ts", "reviewed inline: Opus is at least as strong as Opus"] };

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

test("testsClaim reads the last marker: a later VERDICT or count settles an earlier one", () => {
  expect(testsClaim("2 failing earlier, then fixed.\nVERDICT: PASS")).toBe(true);
  expect(testsClaim("VERDICT: PASS\nbut then 2 failing")).toBe(false);
  expect(testsClaim("VERDICT: FAIL\nthen VERDICT: PASS")).toBe(true);
  expect(testsClaim("1 failing\n12 passing")).toBe(true);
  expect(testsClaim("12 passing\n1 failing")).toBe(false);
});

test("testsClaim ignores a zero count, which says nothing either way", () => {
  expect(testsClaim("0 failed")).toBe(null);
  expect(testsClaim("5 passed\n0 failed")).toBe(true);
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

test("with the tools on, the default and an explicit toolsOn give the same note", () => {
  expect(reviewNote("Isaac Newline", deep, ["a"], 3)).toBe(reviewNote("Isaac Newline", deep, ["a"], 3, { toolsOn: true }));
});

test("an inline deep plan tells the main model to review the risky hunks itself and record, never to launch a reviewer", () => {
  const on = reviewNote("Isaac Newline", inline, ["a"], 3);
  expect(on).toContain("Tier deep: touches hooks/register.ts; reviewed inline");
  expect(on).toContain("Review the risky hunks yourself (public API, security, concurrency, permissions, data loss)");
  expect(on).toContain("call mcp__haikrew__record_verdict");
  expect(on).not.toContain("HAIKREW job=review");
  expect(on).not.toContain("Launch a reviewer");
  const off = reviewNote("Isaac Newline", inline, ["a"], 3, { toolsOn: false });
  expect(off).toContain("Review the risky hunks yourself");
  expect(off).not.toContain("HAIKREW job=review");
  expect(off).not.toContain("record_verdict");
});

test("with the tools off, a light note names no tool and asks for the result in the reply", () => {
  const l = reviewNote("Isaac Newline", light, ["a"], 3, { toolsOn: false });
  expect(l).toContain("Glance at the diff");
  expect(l).not.toContain("record_verdict");
  expect(l).not.toContain("review_packet");
  expect(l).not.toContain("mcp__haikrew__");
});

test("a light change with the checker launches haikrew:haiku-checker with job=check, and never asks for record_verdict", () => {
  const on = reviewNote("Isaac Newline", checked, ["a"], 3);
  expect(on).toContain("Tier light: only light paths changed, 3 lines.");
  expect(on).toContain("subagent_type `haikrew:haiku-checker`");
  expect(on).toContain("HAIKREW job=check name=<a name>");
  expect(on).toContain('naming agent "Isaac Newline" to check');
  expect(on).toContain("a FAIL means fix the work");
  expect(on).not.toContain("record_verdict");
  expect(on).not.toContain("Glance at the diff");
  expect(on).not.toContain("put this review packet");
  expect(reviewNote("Isaac Newline", checked, ["a"], 3, { toolsOn: true })).toBe(on);
});

test("with the tools off, the checker note carries the packet and names no tool", () => {
  const packet = "# Review packet: Isaac Newline\n\nVERDICT: PASS for Isaac Newline";
  const off = reviewNote("Isaac Newline", checked, ["a"], 3, { toolsOn: false, packet });
  expect(off).toContain("subagent_type `haikrew:haiku-checker`");
  expect(off).toContain(`put this review packet in its prompt:\n\n${packet}`);
  expect(off).not.toContain("mcp__haikrew__");
  expect(off).not.toContain("record_verdict");
});

test("with the tools off, a standard or deep note carries the packet and names no tool", () => {
  const packet = "# Review packet: Isaac Newline\n\nVERDICT: PASS for Isaac Newline";
  const d = reviewNote("Isaac Newline", deep, ["a"], 3, { toolsOn: false, packet });
  expect(d).toContain("opus at high effort");
  expect(d).toContain("HAIKREW job=review name=<a name>");
  expect(d).toContain(`put this review packet in its prompt:\n\n${packet}`);
  expect(d).not.toContain("review_packet");
  expect(d).not.toContain("record_verdict");
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
