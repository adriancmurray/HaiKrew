import test from "node:test";
import assert from "node:assert/strict";
import { summarize, runPipeline } from "./aggregator.ts";

const zero = () => ({ debug: 0, info: 0, warn: 0, error: 0 });
const ev = (level: string, source = "api", extra = {}) => ({ ts: 1700000000, level, source, message: "m", ...extra });

test("summarize of nothing has all four levels at zero", () => {
  assert.deepEqual(summarize([]), { total: 0, byLevel: zero(), bySource: {}, truncated: 0 });
});
test("summarize counts levels and sources", () => {
  assert.deepEqual(summarize([ev("info"), ev("error", "db"), ev("info", "db")]), {
    total: 3, byLevel: { debug: 0, info: 2, warn: 0, error: 1 }, bySource: { api: 1, db: 2 }, truncated: 0,
  });
});
test("summarize counts truncated events", () => {
  assert.equal(summarize([ev("warn", "api", { truncated: true }), ev("warn")]).truncated, 1);
});
test("a source named like an Object prototype member is counted", () => {
  assert.deepEqual(summarize([ev("info", "constructor")]).bySource, { constructor: 1 });
});
test("runPipeline of nothing is an empty report", () => {
  assert.deepEqual(runPipeline([]), { summary: { total: 0, byLevel: zero(), bySource: {}, truncated: 0 }, rejected: [] });
});
test("blank lines are skipped but still take a line number", () => {
  assert.deepEqual(runPipeline(["", "   ", "nope"]).rejected, [{ line: 3, reason: "syntax" }]);
});
test("rejections keep input order and line numbers", () => {
  const r = runPipeline(["bad", "1700000000 INFO api: ok", "1700000000 INFO api:"]);
  assert.deepEqual(r.rejected, [{ line: 1, reason: "syntax" }, { line: 3, reason: "empty" }]);
  assert.equal(r.summary.total, 1);
});
