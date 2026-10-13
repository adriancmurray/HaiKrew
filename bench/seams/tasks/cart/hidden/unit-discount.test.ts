import test from "node:test";
import assert from "node:assert/strict";
import { discountOf } from "./discount.ts";

const base = (cents: number, currency = "USD") => ({ cents, currency });

test("no discount is zero in the base currency", () => {
  assert.deepEqual(discountOf(base(500, "EUR")), { cents: 0, currency: "EUR" });
});
test("percent rounds half up", () => {
  assert.deepEqual(discountOf(base(1005), { kind: "percent", percent: 10 }), { cents: 101, currency: "USD" });
});
test("percent of a zero base is zero", () => {
  assert.deepEqual(discountOf(base(0), { kind: "percent", percent: 50 }), { cents: 0, currency: "USD" });
});
test("100 percent takes the whole base", () => {
  assert.deepEqual(discountOf(base(999), { kind: "percent", percent: 100 }), { cents: 999, currency: "USD" });
});
test("percent above 100 is a RangeError", () => {
  assert.throws(() => discountOf(base(100), { kind: "percent", percent: 101 }), RangeError);
});
test("negative percent is a RangeError", () => {
  assert.throws(() => discountOf(base(100), { kind: "percent", percent: -1 }), RangeError);
});
test("flat amount is taken as given", () => {
  assert.deepEqual(discountOf(base(1000), { kind: "flat", cents: 250 }), { cents: 250, currency: "USD" });
});
test("flat amount is capped at the base", () => {
  assert.deepEqual(discountOf(base(300), { kind: "flat", cents: 500 }), { cents: 300, currency: "USD" });
});
test("negative flat amount is a RangeError", () => {
  assert.throws(() => discountOf(base(300), { kind: "flat", cents: -5 }), RangeError);
});
test("fractional flat amount is a RangeError", () => {
  assert.throws(() => discountOf(base(300), { kind: "flat", cents: 1.5 }), RangeError);
});
