import test from "node:test";
import assert from "node:assert/strict";
import { sortRows } from "./table.ts";
import { topByAge } from "./report.ts";

const rows = [
  { id: 1, dept: "b", age: 30 }, { id: 2, dept: "a", age: 40 },
  { id: 3, dept: "b", age: 20 }, { id: 4, dept: "a", age: 40 },
];
test("single key", () => {
  assert.deepEqual(sortRows(rows, "age").map((r) => r.id), [3, 1, 2, 4]);
  assert.deepEqual(sortRows(rows, "age", "desc").map((r) => r.id), [2, 4, 1, 3]);
});
test("bad dir", () => assert.throws(() => sortRows(rows, "age", "up" as any), TypeError));
test("topByAge", () => assert.deepEqual(topByAge(rows, 2).map((r) => r.id), [2, 4]));
test("multi key", () => {
  assert.deepEqual(sortRows(rows, [{ key: "dept" }, { key: "age", dir: "desc" }]).map((r) => r.id), [2, 4, 1, 3]);
});
