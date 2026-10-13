import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { debounce } from "./timing.ts";
import { makeSearch } from "./search.ts";

test("trailing call with last args", () => {
  mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const seen: number[] = [];
  const d = debounce((n: number) => { seen.push(n); }, 100);
  d(1); d(2); mock.timers.tick(99); assert.deepEqual(seen, []);
  mock.timers.tick(1); assert.deepEqual(seen, [2]);
  mock.timers.reset();
});
test("makeSearch debounces at 300ms", () => {
  mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const seen: string[] = [];
  const s = makeSearch((q) => { seen.push(q); });
  s("a"); s("ab"); mock.timers.tick(300);
  assert.deepEqual(seen, ["ab"]);
  mock.timers.reset();
});
test("cancel and flush exist", () => {
  mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const seen: number[] = [];
  const d = debounce((n: number) => { seen.push(n); }, 100);
  d(1); d.flush(); assert.deepEqual(seen, [1]);
  d(2); d.cancel(); mock.timers.tick(500); assert.deepEqual(seen, [1]);
  mock.timers.reset();
});
