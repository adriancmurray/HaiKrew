import test, { mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { debounce } from "./timing.ts";
import { makeSearch } from "./search.ts";

beforeEach(() => mock.timers.enable({ apis: ["setTimeout", "Date"] }));
afterEach(() => mock.timers.reset());
const rec = () => { const seen: any[][] = []; return { seen, fn: (...a: any[]) => { seen.push(a); } }; };

test("trailing: waits full ms after last call", () => {
  const r = rec(); const d = debounce(r.fn, 100);
  d(1); mock.timers.tick(60); d(2); mock.timers.tick(60);
  assert.deepEqual(r.seen, []);
  mock.timers.tick(40); assert.deepEqual(r.seen, [[2]]);
});
test("fires once per burst, again for the next burst", () => {
  const r = rec(); const d = debounce(r.fn, 50);
  d("a"); mock.timers.tick(50); d("b"); mock.timers.tick(50);
  assert.deepEqual(r.seen, [["a"], ["b"]]);
});
test("preserves this", () => {
  const o = { n: 0, bump: debounce(function (this: any) { this.n++; }, 10) as any };
  o.bump(); mock.timers.tick(10); assert.equal(o.n, 1);
});
test("passes all args", () => {
  const r = rec(); const d = debounce(r.fn, 10);
  d(1, "two", { three: 3 }); mock.timers.tick(10);
  assert.deepEqual(r.seen, [[1, "two", { three: 3 }]]);
});
test("cancel drops the pending call", () => {
  const r = rec(); const d = debounce(r.fn, 10);
  d(1); d.cancel(); mock.timers.tick(100); assert.deepEqual(r.seen, []);
});
test("cancel with nothing pending is harmless; works again afterwards", () => {
  const r = rec(); const d = debounce(r.fn, 10);
  d.cancel(); d(1); mock.timers.tick(10); assert.deepEqual(r.seen, [[1]]);
  d(2); d.cancel(); d(3); mock.timers.tick(10); assert.deepEqual(r.seen, [[1], [3]]);
});
test("flush runs pending call now with last args, exactly once", () => {
  const r = rec(); const d = debounce(r.fn, 100);
  d(1); d(2); d.flush(); assert.deepEqual(r.seen, [[2]]);
  mock.timers.tick(500); assert.deepEqual(r.seen, [[2]]);
});
test("flush with nothing pending does nothing", () => {
  const r = rec(); const d = debounce(r.fn, 100);
  d.flush(); assert.deepEqual(r.seen, []);
  d(1); mock.timers.tick(100); d.flush(); assert.deepEqual(r.seen, [[1]]);
});
test("flush keeps this", () => {
  const o = { n: 0, bump: debounce(function (this: any) { this.n++; }, 10) as any };
  o.bump(); o.bump.flush(); assert.equal(o.n, 1);
});
test("leading: first call is immediate, single call fires once", () => {
  const r = rec(); const d = debounce(r.fn, 100, { leading: true });
  d(1); assert.deepEqual(r.seen, [[1]]);
  mock.timers.tick(500); assert.deepEqual(r.seen, [[1]]);
});
test("leading: more calls in the burst give one trailing call with the last args", () => {
  const r = rec(); const d = debounce(r.fn, 100, { leading: true });
  d(1); d(2); d(3); assert.deepEqual(r.seen, [[1]]);
  mock.timers.tick(100); assert.deepEqual(r.seen, [[1], [3]]);
});
test("leading: a new burst after quiet leads again", () => {
  const r = rec(); const d = debounce(r.fn, 100, { leading: true });
  d(1); mock.timers.tick(100); d(2); assert.deepEqual(r.seen, [[1], [2]]);
  mock.timers.tick(100); assert.deepEqual(r.seen, [[1], [2]]);
});
test("leading: calls keep extending the burst", () => {
  const r = rec(); const d = debounce(r.fn, 100, { leading: true });
  d(1); mock.timers.tick(80); d(2); mock.timers.tick(80); d(3);
  assert.deepEqual(r.seen, [[1]]);
  mock.timers.tick(100); assert.deepEqual(r.seen, [[1], [3]]);
});
test("leading: flush runs only the trailing call; none pending is a no-op", () => {
  const r = rec(); const d = debounce(r.fn, 100, { leading: true });
  d(1); d.flush(); assert.deepEqual(r.seen, [[1]]);
  const r2 = rec(); const e = debounce(r2.fn, 100, { leading: true });
  e(1); e(2); e(3); e.flush(); assert.deepEqual(r2.seen, [[1], [3]]);
  mock.timers.tick(500); assert.deepEqual(r2.seen, [[1], [3]]);
});
test("leading: cancel ends the burst, next call leads", () => {
  const r = rec(); const d = debounce(r.fn, 100, { leading: true });
  d(1); d(2); d.cancel(); mock.timers.tick(500);
  assert.deepEqual(r.seen, [[1]]);
  d(3); assert.deepEqual(r.seen, [[1], [3]]);
});
test("leading: preserves this", () => {
  const o = { n: 0, bump: debounce(function (this: any) { this.n++; }, 10, { leading: true }) as any };
  o.bump(); assert.equal(o.n, 1);
});
test("leading:false behaves like the default", () => {
  const r = rec(); const d = debounce(r.fn, 10, { leading: false });
  d(1); assert.deepEqual(r.seen, []); mock.timers.tick(10); assert.deepEqual(r.seen, [[1]]);
});
test("errors from fn propagate from flush and leading call", () => {
  const d = debounce(() => { throw new Error("bad"); }, 10);
  d(); assert.throws(() => d.flush(), /bad/);
  const l = debounce(() => { throw new Error("lead"); }, 10, { leading: true });
  assert.throws(() => l(), /lead/);
});
test("each debounced function has its own state", () => {
  const r1 = rec(), r2 = rec(); const a = debounce(r1.fn, 10), b = debounce(r2.fn, 10);
  a(1); b(2); a.cancel(); mock.timers.tick(10);
  assert.deepEqual(r1.seen, []); assert.deepEqual(r2.seen, [[2]]);
});
test("makeSearch still works and exposes cancel", () => {
  const r = rec(); const s = makeSearch((q) => r.fn(q));
  s("a"); s("ab"); mock.timers.tick(300);
  assert.deepEqual(r.seen, [["ab"]]);
  s("x"); (s as any).cancel(); mock.timers.tick(300); assert.equal(r.seen.length, 1);
});
