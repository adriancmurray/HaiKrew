/** Currencies the shop prices in. */
export type Currency = "USD" | "EUR";

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

/** Rounds half up to whole cents. Float noise such as 2.4999999999999996 is removed first. */
export function roundCents(x: number): number {
  return Math.round(Number(x.toFixed(9)));
}
