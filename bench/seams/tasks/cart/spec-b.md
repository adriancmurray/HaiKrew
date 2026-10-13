# Part B: tax

Create `tax.ts`. It exports `taxOn(items: CartItem[], rate: number): Money`.

- `rate` must be a finite number from 0 to `MAX_TAX_RATE` inclusive. Otherwise throw `RangeError`.
- Only items with `taxable: true` count. Each taxable line's tax is `roundCents(price.cents * qty * rate)` (from `./money.ts`, which rounds half up to whole cents). The result is the sum of the line taxes.
- Throws `Error` if the items do not all share one currency. An empty list returns `{ cents: 0, currency: "USD" }`. Otherwise the currency is the items' currency.

Shared file `money.ts`: add `export const MAX_TAX_RATE = 0.5;`. Change nothing else in it.

Rules: `import type` for types, `.ts` in local import paths, no enums or namespaces (Node type stripping). Do not edit other files.
