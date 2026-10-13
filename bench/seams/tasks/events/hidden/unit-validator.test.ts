import test from "node:test";
import assert from "node:assert/strict";
import { validate } from "./validator.ts";

const ev = (over = {}) => ({ ts: 1700000000, level: "info", source: "api", message: "hello", ...over });

test("valid event comes back unchanged", () => {
  assert.deepEqual(validate(ev(), 3), { ts: 1700000000, level: "info", source: "api", message: "hello" });
});
test("accepted event has no truncated key", () => {
  assert.equal("truncated" in (validate(ev(), 1) as object), false);
});
test("ts below 1000000000 is rejected with the line number", () => {
  assert.deepEqual(validate(ev({ ts: 999999999 }), 9), { line: 9, reason: "ts" });
});
test("non-integer ts is rejected", () => {
  assert.deepEqual(validate(ev({ ts: 1700000000.5 }), 2), { line: 2, reason: "ts" });
});
test("source with uppercase is rejected", () => {
  assert.deepEqual(validate(ev({ source: "Api" }), 4), { line: 4, reason: "source" });
});
test("source with underscore or leading digit is rejected", () => {
  assert.deepEqual(validate(ev({ source: "api_db" }), 4), { line: 4, reason: "source" });
  assert.deepEqual(validate(ev({ source: "1api" }), 4), { line: 4, reason: "source" });
});
test("hyphenated lowercase source is accepted", () => {
  assert.equal((validate(ev({ source: "db-pool" }), 1) as { source: string }).source, "db-pool");
});
test("blank message is rejected as empty", () => {
  assert.deepEqual(validate(ev({ message: "   " }), 5), { line: 5, reason: "empty" });
});
test("ts is checked before source and message", () => {
  assert.deepEqual(validate(ev({ ts: 1, source: "BAD", message: "" }), 6), { line: 6, reason: "ts" });
});
test("source is checked before an empty message", () => {
  assert.deepEqual(validate(ev({ source: "BAD", message: "" }), 6), { line: 6, reason: "source" });
});
test("a 200-character message passes untouched", () => {
  const e = validate(ev({ message: "x".repeat(200) }), 1) as { message: string; truncated?: boolean };
  assert.equal(e.message.length, 200);
  assert.equal(e.truncated, undefined);
});
test("a longer message is cut to 200 characters and flagged", () => {
  const e = validate(ev({ message: "y".repeat(205) }), 1) as { message: string; truncated?: boolean };
  assert.equal(e.message, "y".repeat(200));
  assert.equal(e.truncated, true);
});
test("truncation counts code points and never splits a surrogate pair", () => {
  const e = validate(ev({ message: "a".repeat(199) + "😀😀" }), 1) as { message: string; truncated?: boolean };
  assert.equal(e.message, "a".repeat(199) + "😀");
  assert.equal(e.truncated, true);
});
