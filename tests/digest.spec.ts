/** `haikrew digest`: a transcript past the mod's 4 MiB read limit gives the same fields as the in-mod parser, in small output. */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { digestFile } from "../plugin/src/digest.ts";
import { parseTranscriptText } from "../plugin/src/mod/ledger.ts";

const dir = mkdtempSync(join(tmpdir(), "haikrew-digest-"));
after(() => rmSync(dir, { recursive: true, force: true }));

const LIMIT = 4 * 1024 * 1024;

function lines(report: string): string[] {
  const user = (text: string, ts: string) => JSON.stringify({ type: "user", timestamp: ts, message: { role: "user", content: text } });
  const tool = (ts: string) => JSON.stringify({
    type: "user",
    timestamp: ts,
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "x".repeat(1024 * 1024) }] },
  });
  const assistant = (id: string, ts: string, content: unknown[]) => JSON.stringify({
    type: "assistant",
    timestamp: ts,
    message: { id, model: "claude-haiku-5-5", usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 2, cache_read_input_tokens: 3 }, content },
  });
  return [
    user("HAIKREW job=implement lang=ts name=Ada\nDo the work.", "2026-10-30T10:00:00.000Z"),
    assistant("m1", "2026-10-30T10:00:05.000Z", [{ type: "tool_use", id: "t1", name: "Read", input: {} }]),
    ...Array.from({ length: 5 }, () => tool("2026-10-30T10:00:06.000Z")),
    "not json",
    assistant("m2", "2026-10-30T10:01:00.000Z", [{ type: "text", text: report }]),
  ];
}

function write(name: string, body: string[]): string {
  const path = join(dir, name);
  writeFileSync(path, body.join("\n"));
  return path;
}

describe("digestFile", () => {
  it("matches the in-mod parser on a transcript over the read limit", async () => {
    const body = lines("All done.\nVERDICT: PASS");
    const text = body.join("\n");
    assert.ok(Buffer.byteLength(text) > LIMIT);
    const digest = await digestFile(write("big.jsonl", body));
    assert.deepEqual({ ...digest, report: undefined }, { ...parseTranscriptText(text), report: undefined });
    assert.equal(digest.report, "All done.\nVERDICT: PASS");
    assert.equal(digest.job, "implement");
    assert.equal(digest.lang, "ts");
    assert.equal(digest.tokens_in, 24);
    assert.equal(digest.tool_calls, 1);
    assert.equal(digest.self_verdict, "pass");
  });

  it("keeps the end of a long report and fits under the read limit", async () => {
    const digest = await digestFile(write("long.jsonl", lines(`${"y".repeat(6 * 1024 * 1024)}\nVERDICT: FAIL for Ada`)));
    assert.ok(digest.report.endsWith("VERDICT: FAIL for Ada"));
    assert.ok(Buffer.byteLength(JSON.stringify(digest)) < LIMIT);
  });

  it("keeps a line that holds a raw U+2028 or U+2029, as the in-mod parser does", async () => {
    const body = lines("All\u2028done.\u2029\nVERDICT: PASS");
    const digest = await digestFile(write("separators.jsonl", body));
    assert.deepEqual({ ...digest, report: undefined }, { ...parseTranscriptText(body.join("\n")), report: undefined });
    assert.equal(digest.report, "All\u2028done.\u2029\nVERDICT: PASS");
    assert.equal(digest.self_verdict, "pass");
  });

  it("rejects a missing file", async () => {
    await assert.rejects(digestFile(join(dir, "gone.jsonl")));
  });
});
