import type { Breakdown, CartItem, Discount, Money } from "./money.ts";
import { discountOf } from "./discount.ts";
import { taxOn } from "./tax.ts";

/** Sum of price times quantity over the items. Throws on a bad quantity or mixed currencies. */
export function subtotal(items: CartItem[]): Money {
  if (items.length === 0) return { cents: 0, currency: "USD" };
  const currency = items[0].price.currency;
  let cents = 0;
  for (const item of items) {
    if (!Number.isInteger(item.qty) || item.qty < 1) throw new RangeError(`bad qty for ${item.sku}`);
    if (item.price.currency !== currency) throw new Error("mixed currencies");
    cents += item.price.cents * item.qty;
  }
  return { cents, currency };
}

/** Subtotal, discount, tax and total for a cart. */
export function checkout(items: CartItem[], opts: { taxRate: number; discount?: Discount }): Breakdown {
  const sub = subtotal(items);
  const discount = discountOf(sub, opts.discount);
  const tax = taxOn(items, opts.taxRate);
  const total = { cents: sub.cents - discount.cents + tax.cents, currency: sub.currency };
  return { subtotal: sub, discount, tax, total };
}
