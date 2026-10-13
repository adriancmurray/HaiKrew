import test from "node:test";
import assert from "node:assert/strict";
import { taxOn } from "./tax.ts";

const item = (cents: number, qty = 1, taxable = true) => ({ sku: "s", price: { cents, currency: "USD" }, qty, taxable });

test("tax is the rate times the taxable amount", () => {
  assert.deepEqual(taxOn([item(1000)], 0.1), { cents: 100, currency: "USD" });
});
test("half a cent rounds up, even when the float product lands just below", () => {
  assert.deepEqual(taxOn([item(1000)], 0.0825), { cents: 83, currency: "USD" });
});
test("untaxable items are left out", () => {
  assert.deepEqual(taxOn([item(5000, 1, false)], 0.2), { cents: 0, currency: "USD" });
});
test("each taxable line is rounded on its own and then summed", () => {
  assert.deepEqual(taxOn([item(333, 3), item(1999)], 0.1), { cents: 300, currency: "USD" });
});
test("quantity multiplies the taxable amount", () => {
  assert.deepEqual(taxOn([item(100, 4)], 0.1), { cents: 40, currency: "USD" });
});
test("rate 0 gives zero tax", () => {
  assert.deepEqual(taxOn([item(999)], 0), { cents: 0, currency: "USD" });
});
test("the maximum rate 0.5 is allowed", () => {
  assert.deepEqual(taxOn([item(100)], 0.5), { cents: 50, currency: "USD" });
});
test("rates above the maximum, below zero or not finite are RangeErrors", () => {
  assert.throws(() => taxOn([item(100)], 0.6), RangeError);
  assert.throws(() => taxOn([item(100)], -0.1), RangeError);
  assert.throws(() => taxOn([item(100)], Number.NaN), RangeError);
});
test("empty list is zero USD", () => {
  assert.deepEqual(taxOn([], 0.2), { cents: 0, currency: "USD" });
});
