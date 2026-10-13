import test from "node:test";
import assert from "node:assert/strict";
import { parseLine } from "./parser.ts";

test("parses a plain line", () => {
  assert.deepEqual(parseLine("1700000000 info api: started", 1), { ts: 1700000000, level: "info", source: "api", message: "started" });
});
test("level is case-insensitive and comes back lowercase", () => {
  assert.deepEqual(parseLine("1700000000 WARN db: slow", 2), { ts: 1700000000, level: "warn", source: "db", message: "slow" });
});
test("debug is a level", () => {
  assert.equal(parseLine("1700000000 DEBUG api: x", 1).level, "debug");
});
test("colons after the separator stay in the message", () => {
  assert.deepEqual(parseLine("1700000000 INFO api: a: b:c", 1), { ts: 1700000000, level: "info", source: "api", message: "a: b:c" });
});
test("surrounding whitespace is ignored and the message is trimmed", () => {
  assert.deepEqual(parseLine("   1700000000 INFO api:    hi   ", 1), { ts: 1700000000, level: "info", source: "api", message: "hi" });
});
test("an empty message is accepted by the parser", () => {
  assert.deepEqual(parseLine("1700000000 INFO api:", 1), { ts: 1700000000, level: "info", source: "api", message: "" });
});
test("unknown level is rejected with its line number", () => {
  assert.deepEqual(parseLine("1700000000 TRACE api: x", 7), { line: 7, reason: "level" });
});
test("missing timestamp is a syntax rejection", () => {
  assert.deepEqual(parseLine("INFO api: x", 4), { line: 4, reason: "syntax" });
});
test("missing colon after the source is a syntax rejection", () => {
  assert.deepEqual(parseLine("1700000000 INFO api x", 5), { line: 5, reason: "syntax" });
});
test("non-digit timestamp is a syntax rejection", () => {
  assert.deepEqual(parseLine("17e8 INFO api: x", 6), { line: 6, reason: "syntax" });
});
