/**
 * Money between currencies at the shipped rates (rates.ts): `100 usd to eur`,
 * `$20 in yen`, `50€ in gbp`, `10 pounds in dollars`. A currency is its ISO
 * code, its sign, or its everyday name.
 */

import type { Rates } from "./rates.ts";

/** Signs and names to codes; codes themselves are matched as they are. */
const NAMES: ReadonlyMap<string, string> = new Map(
  Object.entries({
    USD: ["$", "us$", "dollar", "dollars", "buck", "bucks"],
    EUR: ["€", "euro", "euros"],
    GBP: ["£", "pound", "pounds", "quid"],
    JPY: ["¥", "yen"],
    CNY: ["yuan", "rmb"],
    INR: ["₹", "rupee", "rupees"],
    KRW: ["₩", "won"],
    TRY: ["₺", "lira"],
    ILS: ["₪", "shekel", "shekels"],
    CHF: ["franc", "francs"],
    BRL: ["r$", "real", "reais"],
    CAD: ["c$"],
    AUD: ["a$"],
    NZD: ["nz$"],
    PLN: ["zł", "zloty"],
    ZAR: ["rand"],
    MXN: ["peso", "pesos"],
    THB: ["baht"],
    SEK: ["krona", "kronor"],
    NOK: ["krone", "kroner"],
    HUF: ["forint"],
  }).flatMap(([code, names]) => names.map((name) => [name, code] as const)),
);

/** The currency `typed` names, if the rates know it. */
export function currencyNamed(typed: string, rates: Rates): string | null {
  const name = typed.trim().toLowerCase();
  const code = NAMES.get(name) ?? name.toUpperCase();
  return rates.perBase[code] !== undefined ? code : null;
}

/** `amount` of `from` in `to`; null when either has no rate. */
export function exchange(amount: number, from: string, to: string, rates: Rates): number | null {
  const fromRate = rates.perBase[from];
  const toRate = rates.perBase[to];
  if (fromRate === undefined || toRate === undefined || fromRate <= 0) return null;
  return (amount / fromRate) * toRate;
}

/** A leading or trailing sign on the amount (`$20`, `20€`), split off: [sign, rest]. */
export function splitSign(text: string): [string, string] | null {
  const leading = /^(us\$|r\$|c\$|a\$|nz\$|[$€£¥₹₩₺₪])\s*(.+)$/i.exec(text);
  if (leading) return [leading[1] as string, leading[2] as string];
  const trailing = /^(.+?)\s*(zł|[$€£¥₹₩₺₪])$/i.exec(text);
  if (trailing) return [trailing[2] as string, trailing[1] as string];
  return null;
}
