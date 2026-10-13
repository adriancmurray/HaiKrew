import test from "node:test";
import assert from "node:assert/strict";
import { checkout } from "./pricing.ts";

const book = { sku: "book", price: { cents: 1250, currency: "USD" }, qty: 2, taxable: false };
const shirt = { sku: "shirt", price: { cents: 1999, currency: "USD" }, qty: 1, taxable: true };
const mug = { sku: "mug", price: { cents: 333, currency: "USD" }, qty: 3, taxable: true };
const cart = [book, shirt, mug];
const usd = (cents: number) => ({ cents, currency: "USD" });

test("checkout without a discount adds tax on the taxable lines only", () => {
  assert.deepEqual(checkout(cart, { taxRate: 0.1 }), {
    subtotal: usd(5498), discount: usd(0), tax: usd(300), total: usd(5798),
  });
});
test("a percent discount comes off the subtotal and tax is not reduced", () => {
  assert.deepEqual(checkout(cart, { taxRate: 0.1, discount: { kind: "percent", percent: 10 } }), {
    subtotal: usd(5498), discount: usd(550), tax: usd(300), total: usd(5248),
  });
});
test("a flat discount larger than the cart leaves a total of zero", () => {
  assert.deepEqual(checkout(cart, { taxRate: 0, discount: { kind: "flat", cents: 999999 } }), {
    subtotal: usd(5498), discount: usd(5498), tax: usd(0), total: usd(0),
  });
});
test("an empty cart checks out at zero USD", () => {
  const zero = usd(0);
  assert.deepEqual(checkout([], { taxRate: 0.2 }), { subtotal: zero, discount: zero, tax: zero, total: zero });
});
test("GBP carries through every Money in the breakdown", () => {
  const gbp = (cents: number) => ({ cents, currency: "GBP" });
  const item = { sku: "x", price: gbp(100), qty: 1, taxable: true };
  assert.deepEqual(checkout([item], { taxRate: 0.2 }), { subtotal: gbp(100), discount: gbp(0), tax: gbp(20), total: gbp(120) });
});
test("mixed currencies in one cart throw", () => {
  const eur = { sku: "e", price: { cents: 100, currency: "EUR" }, qty: 1, taxable: false };
  assert.throws(() => checkout([book, eur], { taxRate: 0 }));
});
test("a tax rate above the maximum is a RangeError", () => {
  assert.throws(() => checkout(cart, { taxRate: 0.9 }), RangeError);
});
test("rounding is half up at each step", () => {
  const item = { sku: "h", price: usd(1005), qty: 1, taxable: true };
  assert.deepEqual(checkout([item], { taxRate: 0.1, discount: { kind: "percent", percent: 10 } }), {
    subtotal: usd(1005), discount: usd(101), tax: usd(101), total: usd(1005),
  });
});
