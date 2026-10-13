# Part C: discount

Create `discount.ts`. It exports `discountOf(base: Money, discount?: Discount): Money`.

- No `discount`: return `{ cents: 0, currency: base.currency }`.
- `kind: "percent"`: `percent` must be a number from 0 to 100 inclusive, else throw `RangeError`. Amount is `roundCents(base.cents * percent / 100)` (from `./money.ts`).
- `kind: "flat"`: `cents` must be an integer of 0 or more, else throw `RangeError`. Amount is `cents`.
- Cap the amount to the range 0 to `base.cents`. The currency is `base.currency`.

Shared file `money.ts`: add `export type Discount = { kind: "percent"; percent: number } | { kind: "flat"; cents: number };`. Change nothing else in it.

Rules: `import type` for types, `.ts` in local import paths, no enums or namespaces (Node type stripping). Do not edit other files.
