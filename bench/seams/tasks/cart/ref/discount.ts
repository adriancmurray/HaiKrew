import type { Discount, Money } from "./money.ts";
import { roundCents } from "./money.ts";

/** The discount amount on `base`, never negative and never more than `base`. */
export function discountOf(base: Money, discount?: Discount): Money {
  if (!discount) return { cents: 0, currency: base.currency };
  let cents: number;
  if (discount.kind === "percent") {
    if (!(discount.percent >= 0 && discount.percent <= 100)) throw new RangeError("bad percent");
    cents = roundCents((base.cents * discount.percent) / 100);
  } else {
    if (!Number.isInteger(discount.cents) || discount.cents < 0) throw new RangeError("bad flat amount");
    cents = discount.cents;
  }
  return { cents: Math.min(Math.max(cents, 0), base.cents), currency: base.currency };
}
