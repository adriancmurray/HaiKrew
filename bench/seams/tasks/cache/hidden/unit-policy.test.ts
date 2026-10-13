import test from "node:test";
import assert from "node:assert/strict";
import { lru, lfu } from "./policy.ts";

const e = (key: string, over = {}) => ({ key, value: "", size: 1, inserted: 0, lastUsed: 0, hits: 0, ...over });

test("lru picks the least recently used entry", () => {
  assert.equal(lru().victim([e("a", { lastUsed: 5 }), e("b", { lastUsed: 2 })]), "b");
});
test("lru ignores hit counts", () => {
  assert.equal(lru().victim([e("a", { lastUsed: 1, hits: 9 }), e("b", { lastUsed: 2, hits: 0 })]), "a");
});
test("lru breaks ties by older insertion", () => {
  assert.equal(lru().victim([e("a", { lastUsed: 3, inserted: 2 }), e("b", { lastUsed: 3, inserted: 1 })]), "b");
});
test("lru breaks full ties by key", () => {
  assert.equal(lru().victim([e("b"), e("a")]), "a");
});
test("lfu picks the fewest hits", () => {
  assert.equal(lfu().victim([e("a", { hits: 3 }), e("b", { hits: 1, lastUsed: 9 })]), "b");
});
test("lfu breaks ties by least recently used", () => {
  assert.equal(lfu().victim([e("a", { hits: 1, lastUsed: 7 }), e("b", { hits: 1, lastUsed: 4 })]), "b");
});
test("lfu breaks full ties by key", () => {
  assert.equal(lfu().victim([e("b"), e("a")]), "a");
});
test("no entries gives undefined from both policies", () => {
  assert.equal(lru().victim([]), undefined);
  assert.equal(lfu().victim([]), undefined);
});
