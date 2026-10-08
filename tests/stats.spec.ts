/** Tests for src/stats.ts: per-model token totals over a day window, from fake transcript trees. */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, beforeEach, describe, test } from "node:test";

const TMP = mkdtempSync(join(tmpdir(), "haikrew-stats-test-"));
process.env.HAIKREW_HOME = join(TMP, "home");
process.env.HAIKREW_DATA = join(TMP, "data");
process.env.HAIKREW_TRANSCRIPTS = join(TMP, "projects");

const stats = await import("../src/stats.ts");
const ROOT = join(TMP, "projects");

const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString();

function assistantLine(mid: string, daysAgo: number, model = "claude-haiku-5-5",
  usage: number[] = [100, 50, 30, 5]): string {
  const [tin, tout, cread, cwrite] = usage;
  const msg = { id: mid, model, content: [], usage: {
    input_tokens: tin, output_tokens: tout, cache_read_input_tokens: cread, cache_creation_input_tokens: cwrite,
  } };
  return JSON.stringify({ type: "assistant", timestamp: iso(daysAgo), message: msg });
}

function write(rel: string, lines: string[]): void {
  const path = join(ROOT, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, lines.join("\n") + "\n");
}

describe("totals", () => {
  beforeEach(() => {
    rmSync(ROOT, { recursive: true, force: true });
  });

  test("message ids are counted once across files", () => {
    write("proj/main.jsonl", [assistantLine("m1", 1), assistantLine("m1", 1),
      assistantLine("m2", 2, "claude-sonnet-x", [7, 3, 0, 0])]);
    write("proj/sess/subagents/agent.jsonl", [assistantLine("m1", 1), assistantLine("m3", 1, "claude-haiku-5-5", [1, 2, 0, 0])]);
    const t = stats.totals(7);
    assert.deepEqual(t["claude-haiku-5-5"], { input: 101, output: 52, cache_read: 30, cache_write: 5, messages: 2 });
    assert.deepEqual(t["claude-sonnet-x"], { input: 7, output: 3, cache_read: 0, cache_write: 0, messages: 1 });
  });

  test("day window excludes older messages", () => {
    write("proj/main.jsonl", [assistantLine("recent", 1), assistantLine("old", 10, "claude-haiku-5-5", [999, 999, 999, 999])]);
    assert.equal(stats.totals(7)["claude-haiku-5-5"].messages, 1);
    assert.equal(stats.totals(7)["claude-haiku-5-5"].input, 100);
    assert.equal(stats.totals(30)["claude-haiku-5-5"].messages, 2);
  });

  test("non-assistant, usage-less and unparseable lines are ignored", () => {
    const user = JSON.stringify({ type: "user", timestamp: iso(1), message: { id: "u1", content: "hi" } });
    const noUsage = JSON.stringify({ type: "assistant", timestamp: iso(1),
      message: { id: "x", model: "claude-haiku-5-5" } });
    write("proj/main.jsonl", [user, noUsage, "{not json", assistantLine("m1", 1)]);
    assert.equal(stats.totals(7)["claude-haiku-5-5"].messages, 1);
  });

  test("missing root gives empty totals", () => {
    assert.deepEqual(stats.totals(7), {});
  });
});

after(() => {
  rmSync(TMP, { recursive: true, force: true });
});
