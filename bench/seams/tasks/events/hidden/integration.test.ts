import test from "node:test";
import assert from "node:assert/strict";
import { runPipeline } from "./aggregator.ts";
import { parseLine } from "./parser.ts";
import { validate } from "./validator.ts";

const LINES = [
  "1700000000 INFO api: started",
  "",
  "1700000001 WARN db-pool: slow",
  "1700000002 TRACE api: x",
  "oops",
  "1700000003 ERROR api:",
  "5 INFO api: too early",
  "1700000004 INFO Bad_Src: x",
  "1700000005 DEBUG api: a: b",
  "   1700000006 error api: " + "x".repeat(250),
];

test("full run: summary and rejections over mixed input", () => {
  assert.deepEqual(runPipeline(LINES), {
    summary: { total: 4, byLevel: { debug: 1, info: 1, warn: 1, error: 1 }, bySource: { api: 3, "db-pool": 1 }, truncated: 1 },
    rejected: [
      { line: 4, reason: "level" },
      { line: 5, reason: "syntax" },
      { line: 6, reason: "empty" },
      { line: 7, reason: "ts" },
      { line: 8, reason: "source" },
    ],
  });
});
test("a parsed then validated line is an event with exactly its fields", () => {
  assert.deepEqual(validate(parseLine("1700000005 DEBUG api: a: b", 9), 9), { ts: 1700000005, level: "debug", source: "api", message: "a: b" });
});
test("an overlong message is counted as truncated", () => {
  assert.equal(runPipeline(["1700000006 error api: " + "x".repeat(250)]).summary.truncated, 1);
});
test("an empty input gives zero for all four levels", () => {
  assert.deepEqual(runPipeline([]).summary.byLevel, { debug: 0, info: 0, warn: 0, error: 0 });
});
test("line numbers keep counting across blank lines", () => {
  assert.deepEqual(runPipeline(["", "", "x"]).rejected, [{ line: 3, reason: "syntax" }]);
});
test("rejected lines do not reach the summary", () => {
  assert.equal(runPipeline(["bad", "1700000000 INFO api: ok"]).summary.total, 1);
});
test("a level written in mixed case is counted under its lowercase name", () => {
  assert.equal(runPipeline(["1700000000 Warn api: x"]).summary.byLevel.warn, 1);
});
