# cart: pricing, tax, discount

Goal: checkout totals. Three parts share the `Money`, `CartItem` and `Breakdown` types and the
`roundCents` helper in `money.ts`. Pricing sums the cart and calls tax and discount, and tax and
discount each compute their own amount.
