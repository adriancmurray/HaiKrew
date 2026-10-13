import test from "node:test";
import assert from "node:assert/strict";
import { subtotal } from "./pricing.ts";

const line = (cents: number, qty = 1, currency = "USD") => ({ sku: "s", price: { cents, currency }, qty, taxable: false });

test("subtotal multiplies price by quantity and adds the lines", () => {
  assert.deepEqual(subtotal([line(250, 2), line(99)]), { cents: 599, currency: "USD" });
});
test("empty cart is zero USD", () => {
  assert.deepEqual(subtotal([]), { cents: 0, currency: "USD" });
});
test("quantity 0 is a RangeError", () => {
  assert.throws(() => subtotal([line(100, 0)]), RangeError);
});
test("fractional quantity is a RangeError", () => {
  assert.throws(() => subtotal([line(100, 1.5)]), RangeError);
});
test("mixed currencies throw", () => {
  assert.throws(() => subtotal([line(100), line(100, 1, "EUR")]));
});
test("GBP is a valid currency", () => {
  assert.deepEqual(subtotal([line(100, 3, "GBP")]), { cents: 300, currency: "GBP" });
});
