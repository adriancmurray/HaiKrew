/** Currencies the shop prices in. */
export type Currency = "USD" | "EUR" | "GBP";

/** An amount in whole minor units (cents) of one currency. */
export interface Money {
  cents: number;
  currency: Currency;
}

/** One line in a cart. `price` is per unit. */
export interface CartItem {
  sku: string;
  price: Money;
  qty: number;
  taxable: boolean;
}

/** Totals for a checkout. */
export interface Breakdown {
  subtotal: Money;
  discount: Money;
  tax: Money;
  total: Money;
}

/** Highest tax rate the shop accepts. */
export const MAX_TAX_RATE = 0.5;

/** A cart discount: a percentage of the subtotal, or a flat amount in cents. */
export type Discount = { kind: "percent"; percent: number } | { kind: "flat"; cents: number };

/** Rounds half up to whole cents. Float noise such as 2.4999999999999996 is removed first. */
export function roundCents(x: number): number {
  return Math.round(Number(x.toFixed(9)));
}
