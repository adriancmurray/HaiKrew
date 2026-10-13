import test from "node:test";
import assert from "node:assert/strict";
import { sortRows } from "./table.ts";
import { topByAge } from "./report.ts";

const rows = [
  { id: 1, dept: "b", age: 30 }, { id: 2, dept: "a", age: 40 },
  { id: 3, dept: "b", age: 20 }, { id: 4, dept: "a", age: 40 },
  { id: 5, dept: "c", age: 10 }, { id: 6, dept: "a", age: 5 },
];
const ids = (r: { id?: any }[]) => r.map((x) => x.id);

test("two keys asc/desc", () => {
  assert.deepEqual(ids(sortRows(rows, [{ key: "dept" }, { key: "age", dir: "desc" }])), [2, 4, 6, 1, 3, 5]);
});
test("first key desc, second asc", () => {
  assert.deepEqual(ids(sortRows(rows, [{ key: "dept", dir: "desc" }, { key: "age", dir: "asc" }])), [5, 3, 1, 6, 2, 4]);
});
test("three keys", () => {
  assert.deepEqual(ids(sortRows(rows, [{ key: "dept" }, { key: "age" }, { key: "id", dir: "desc" }])), [6, 4, 2, 3, 1, 5]);
});
test("full ties keep original order (stable)", () => {
  assert.deepEqual(ids(sortRows(rows, [{ key: "dept" }])), [2, 4, 6, 1, 3, 5]);
  const same = Array.from({ length: 50 }, (_, i) => ({ id: i, k: 1 }));
  assert.deepEqual(ids(sortRows(same, [{ key: "k" }, { key: "zzz" }])), same.map((r) => r.id));
});
test("stable on desc too", () => {
  assert.deepEqual(ids(sortRows(rows, [{ key: "age", dir: "desc" }])), [2, 4, 1, 3, 5, 6]);
});
test("does not mutate rows or keys; returns a new array", () => {
  const copy = JSON.stringify(rows);
  const keys = Object.freeze([Object.freeze({ key: "age", dir: "desc" as const })]) as any;
  const out = sortRows(rows, keys);
  assert.equal(JSON.stringify(rows), copy);
  assert.notEqual(out, rows);
  assert.equal(out[0], rows[1]);
});
test("empty keys array returns a copy in original order", () => {
  const out = sortRows(rows, []);
  assert.deepEqual(ids(out), ids(rows)); assert.notEqual(out, rows);
});
test("empty rows", () => {
  assert.deepEqual(sortRows([], [{ key: "a" }]), []);
  assert.deepEqual(sortRows([], "a"), []);
});
test("numbers compare numerically", () => {
  const r = [{ id: 1, n: 10 }, { id: 2, n: 9 }, { id: 3, n: 100 }];
  assert.deepEqual(ids(sortRows(r, [{ key: "n" }])), [2, 1, 3]);
});
test("null and undefined sort last when ascending, in any key position", () => {
  const r = [{ id: 1, a: null, b: 1 }, { id: 2, a: 1, b: 2 }, { id: 3, b: 3 }, { id: 4, a: 0, b: 4 }, { id: 5, a: 1, b: 1 }];
  assert.deepEqual(ids(sortRows(r as any, [{ key: "a" }, { key: "b" }])), [4, 5, 2, 1, 3]);
});
test("missing key on every row is a no-op ordering", () => {
  assert.deepEqual(ids(sortRows(rows, [{ key: "nope" }])), ids(rows));
});
test("bad dir inside an entry throws TypeError", () => {
  assert.throws(() => sortRows(rows, [{ key: "age", dir: "up" as any }]), TypeError);
  assert.throws(() => sortRows(rows, [{ key: "dept" }, { key: "age", dir: "DESC" as any }]), TypeError);
});
test("bad dir throws even when rows are empty", () => {
  assert.throws(() => sortRows([], [{ key: "a", dir: "x" as any }]), TypeError);
  assert.throws(() => sortRows([], "a", "x" as any), TypeError);
});
test("legacy form still works", () => {
  assert.deepEqual(ids(sortRows(rows, "age")), [6, 5, 3, 1, 2, 4]);
  assert.deepEqual(ids(sortRows(rows, "age", "desc")), [2, 4, 1, 3, 5, 6]);
  assert.throws(() => sortRows(rows, "age", "up" as any), TypeError);
});
test("legacy: does not mutate", () => {
  const copy = JSON.stringify(rows); sortRows(rows, "age"); assert.equal(JSON.stringify(rows), copy);
});
test("topByAge unchanged", () => {
  assert.deepEqual(ids(topByAge(rows, 3)), [2, 4, 1]);
  assert.deepEqual(topByAge([]), []);
});
test("unicode strings", () => {
  const r = [{ id: 1, s: "é" }, { id: 2, s: "z" }, { id: 3, s: "日本" }, { id: 4, s: "a" }];
  assert.deepEqual(ids(sortRows(r, [{ key: "s" }])), [4, 2, 1, 3]);
});
test("large input", () => {
  const n = 200_000;
  const big = Array.from({ length: n }, (_, i) => ({ id: i, g: i % 100, v: (i * 7919) % 1000 }));
  const t = Date.now();
  const out = sortRows(big, [{ key: "g" }, { key: "v", dir: "desc" }]);
  assert.ok(Date.now() - t < 3000);
  assert.equal(out.length, n);
  for (let i = 1; i < n; i += 997) {
    const p = out[i - 1] as any, c = out[i] as any;
    assert.ok(p.g < c.g || (p.g === c.g && p.v >= c.v));
  }
});
