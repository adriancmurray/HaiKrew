# Part A: pricing

Create `pricing.ts`. It exports:

- `subtotal(items: CartItem[]): Money`. Sum of `price.cents * qty` over the items. An empty list returns `{ cents: 0, currency: "USD" }`. Throws `RangeError` if any `qty` is not an integer of 1 or more. Throws `Error` if the items do not all share one currency.
- `checkout(items: CartItem[], opts: { taxRate: number; discount?: Discount }): Breakdown`. Let `sub = subtotal(items)`, `discount = discountOf(sub, opts.discount)` from `./discount.ts`, and `tax = taxOn(items, opts.taxRate)` from `./tax.ts`. `total.cents = sub.cents - discount.cents + tax.cents`. Every Money in the result uses the currency of `sub`. Tax is computed on the taxable items at full price; the discount does not reduce it. Returns `{ subtotal, discount, tax, total }`.

Shared file `money.ts`: add `"GBP"` to the `Currency` union, and export `interface Breakdown { subtotal: Money; discount: Money; tax: Money; total: Money }`. Change nothing else in it.

Rules: `import type` for types, `.ts` in local import paths, no enums or namespaces (Node type stripping). Do not edit other files.
