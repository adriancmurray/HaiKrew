import test from "node:test";
import assert from "node:assert/strict";
import { createStore } from "./store.ts";

const first = { victim: (es: { key: string }[]) => es[0]?.key };
const last = { victim: (es: { key: string }[]) => es[es.length - 1]?.key };

function counter() {
  const c = { hit: 0, miss: 0, evict: 0, evicted: [] as number[] };
  const stats = {
    hit: () => { c.hit++; },
    miss: () => { c.miss++; },
    evict: (bytes: number) => { c.evict++; c.evicted.push(bytes); },
    snapshot: () => ({ hits: c.hit, misses: c.miss, evictions: c.evict, bytesEvicted: 0 }),
  };
  return { c, stats };
}
function make(over = {}) {
  const k = counter();
  const store = createStore({ maxBytes: 100, policy: first, stats: k.stats, ...over });
  return { store, c: k.c };
}

test("get returns the stored value, and undefined for a missing key", () => {
  const { store } = make();
  store.set("a", "one");
  assert.equal(store.get("a"), "one");
  assert.equal(store.get("b"), undefined);
});
test("has does not count as a lookup", () => {
  const { store, c } = make();
  store.set("a", "x");
  store.has("a");
  store.has("zz");
  assert.deepEqual([c.hit, c.miss], [0, 0]);
});
test("get counts a hit or a miss", () => {
  const { store, c } = make();
  store.set("a", "x");
  store.get("a");
  store.get("zz");
  assert.deepEqual([c.hit, c.miss], [1, 1]);
});
test("delete returns true once and then false", () => {
  const { store } = make();
  store.set("a", "x");
  assert.equal(store.delete("a"), true);
  assert.equal(store.delete("a"), false);
  assert.equal(store.has("a"), false);
});
test("keys come back sorted", () => {
  const { store } = make();
  store.set("b", "1");
  store.set("a", "2");
  store.set("c", "3");
  assert.deepEqual(store.keys(), ["a", "b", "c"]);
});
test("bytes counts UTF-8 bytes, not characters", () => {
  const { store } = make();
  store.set("a", "é");
  assert.equal(store.bytes(), 2);
});
test("replacing a key replaces its bytes", () => {
  const { store } = make();
  store.set("a", "xxxx");
  store.set("a", "y");
  assert.equal(store.bytes(), 1);
  assert.deepEqual(store.keys(), ["a"]);
});
test("an oversized value throws RangeError and leaves the store unchanged", () => {
  const { store } = make({ maxBytes: 3 });
  store.set("k", "ab");
  assert.throws(() => store.set("k", "abcd"), RangeError);
  assert.equal(store.get("k"), "ab");
  assert.equal(store.bytes(), 2);
});
test("the policy chooses only among the other entries, never the one just set", () => {
  const { store, c } = make({ maxBytes: 4, policy: last });
  store.set("a", "xx");
  store.set("b", "xx");
  store.set("c", "xx");
  assert.deepEqual(store.keys(), ["a", "c"]);
  assert.equal(c.evict, 1);
});
test("eviction repeats until the budget fits", () => {
  const { store, c } = make({ maxBytes: 4 });
  store.set("a", "xx");
  store.set("b", "xx");
  store.set("c", "xxxx");
  assert.deepEqual(store.keys(), ["c"]);
  assert.equal(c.evict, 2);
});
test("an eviction reports the evicted entry's size", () => {
  const { store, c } = make({ maxBytes: 4 });
  store.set("a", "xx");
  store.set("b", "xx");
  store.set("c", "xx");
  assert.deepEqual(c.evicted, [2]);
});
test("the policy sees the hit count of an entry", () => {
  let seen: { key: string; hits: number }[] = [];
  const spy = { victim: (es: { key: string; hits: number }[]) => { seen = es; return es[0]?.key; } };
  const { store } = make({ maxBytes: 4, policy: spy });
  store.set("a", "xx");
  store.set("b", "xx");
  store.get("a");
  store.set("c", "xx");
  assert.equal(seen.find((e) => e.key === "a")?.hits, 1);
  assert.equal(seen.find((e) => e.key === "b")?.hits, 0);
});
