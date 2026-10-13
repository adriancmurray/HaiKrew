import test from "node:test";
import assert from "node:assert/strict";
import { createStore } from "./store.ts";
import { createStats, hitRate } from "./stats.ts";
import { lru, lfu } from "./policy.ts";

function clock() {
  let t = 0;
  return () => ++t;
}
function setup(maxBytes: number, policy: { victim: (es: never[]) => string | undefined }) {
  const stats = createStats();
  const store = createStore({ maxBytes, policy, stats, now: clock() });
  return { store, stats };
}

test("LRU evicts the entry used longest ago", () => {
  const { store, stats } = setup(6, lru());
  store.set("a", "aa");
  store.set("b", "bb");
  store.set("c", "cc");
  store.get("a");
  store.set("d", "dd");
  assert.deepEqual(store.keys(), ["a", "c", "d"]);
  assert.deepEqual(stats.snapshot(), { hits: 1, misses: 0, evictions: 1, bytesEvicted: 2 });
});
test("LFU evicts the least used entry and never the value just set", () => {
  const { store, stats } = setup(4, lfu());
  store.set("a", "aa");
  store.set("b", "bb");
  store.get("a");
  store.get("a");
  store.set("c", "cc");
  assert.deepEqual(store.keys(), ["a", "c"]);
  assert.equal(stats.snapshot().evictions, 1);
});
test("hit rate reflects gets and misses but not has", () => {
  const { store, stats } = setup(10, lru());
  store.set("x", "1234");
  store.get("x");
  store.get("y");
  store.get("x");
  store.has("x");
  const snap = stats.snapshot();
  assert.deepEqual(snap, { hits: 2, misses: 1, evictions: 0, bytesEvicted: 0 });
  assert.equal(hitRate(snap), 2 / 3);
});
test("an oversized value throws and leaves the store as it was", () => {
  const { store } = setup(3, lru());
  store.set("k", "ab");
  assert.throws(() => store.set("k", "abcd"), RangeError);
  assert.equal(store.get("k"), "ab");
  assert.equal(store.bytes(), 2);
});
test("the budget counts UTF-8 bytes", () => {
  const { store, stats } = setup(4, lru());
  store.set("a", "é");
  store.set("b", "éé");
  assert.deepEqual(store.keys(), ["b"]);
  assert.equal(store.bytes(), 4);
  assert.equal(stats.snapshot().evictions, 1);
});
test("replacing a key does not count its old value against the budget", () => {
  const { store, stats } = setup(4, lru());
  store.set("a", "xxxx");
  store.set("a", "yy");
  store.set("b", "zz");
  assert.deepEqual(store.keys(), ["a", "b"]);
  assert.equal(stats.snapshot().evictions, 0);
});
test("delete frees budget for later sets", () => {
  const { store, stats } = setup(4, lru());
  store.set("a", "xx");
  store.set("b", "xx");
  store.delete("a");
  store.set("c", "xx");
  assert.deepEqual(store.keys(), ["b", "c"]);
  assert.equal(stats.snapshot().evictions, 0);
});
test("keys come back sorted", () => {
  const { store } = setup(10, lru());
  store.set("b", "1");
  store.set("a", "2");
  store.set("c", "3");
  assert.deepEqual(store.keys(), ["a", "b", "c"]);
});
