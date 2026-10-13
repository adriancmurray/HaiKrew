import test from "node:test";
import assert from "node:assert/strict";
import { createStats, hitRate } from "./stats.ts";

test("new stats are all zero", () => {
  assert.deepEqual(createStats().snapshot(), { hits: 0, misses: 0, evictions: 0, bytesEvicted: 0 });
});
test("each call adds to its counter, and evict adds its bytes", () => {
  const s = createStats();
  s.hit();
  s.hit();
  s.miss();
  s.evict(3);
  assert.deepEqual(s.snapshot(), { hits: 2, misses: 1, evictions: 1, bytesEvicted: 3 });
});
test("a snapshot is a copy", () => {
  const s = createStats();
  const before = s.snapshot();
  s.hit();
  assert.deepEqual(before, { hits: 0, misses: 0, evictions: 0, bytesEvicted: 0 });
  assert.deepEqual(s.snapshot(), { hits: 1, misses: 0, evictions: 0, bytesEvicted: 0 });
});
test("hit rate is zero with no lookups, even with evictions", () => {
  assert.equal(hitRate({ hits: 0, misses: 0, evictions: 5, bytesEvicted: 9 }), 0);
});
test("hit rate is hits over lookups", () => {
  assert.equal(hitRate({ hits: 3, misses: 1, evictions: 0, bytesEvicted: 0 }), 0.75);
});
test("hit rate ignores evictions", () => {
  assert.equal(hitRate({ hits: 1, misses: 2, evictions: 9, bytesEvicted: 0 }), 1 / 3);
});
