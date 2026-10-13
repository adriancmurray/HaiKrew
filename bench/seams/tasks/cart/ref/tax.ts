import type { CartItem, Money } from "./money.ts";
import { MAX_TAX_RATE, roundCents } from "./money.ts";

/** Tax on the taxable items at `rate`, rounded per line. */
export function taxOn(items: CartItem[], rate: number): Money {
  if (!Number.isFinite(rate) || rate < 0 || rate > MAX_TAX_RATE) throw new RangeError(`bad tax rate ${rate}`);
  const currency = items[0]?.price.currency ?? "USD";
  let cents = 0;
  for (const item of items) {
    if (item.price.currency !== currency) throw new Error("mixed currencies");
    if (item.taxable) cents += roundCents(item.price.cents * item.qty * rate);
  }
  return { cents, currency };
}
