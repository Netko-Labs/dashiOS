/**
 * Exchange rates for the answer row, shipped with Dashi: the shell fetches
 * nothing to answer "100 usd to eur", so the answer is the same offline and
 * says how old it is ("rates from 2026-11-05"). These are the European
 * Central Bank's euro reference rates of that day
 * (ecb.europa.eu/stats/eurofxref); refresh the table and its date together.
 */

export interface Rates {
  /** The day the rates are from, `YYYY-MM-DD`. */
  date: string;
  /** What one `base` buys of each currency. */
  base: string;
  perBase: Readonly<Record<string, number>>;
}

export const RATES: Rates = {
  date: "2026-11-05",
  base: "EUR",
  perBase: {
    EUR: 1,
    USD: 1.1224,
    JPY: 177.85,
    CZK: 24.289,
    DKK: 7.4747,
    GBP: 0.83393,
    HUF: 363.18,
    PLN: 4.389,
    RON: 5.3385,
    SEK: 10.9845,
    CHF: 0.918,
    ISK: 136.8,
    NOK: 10.4365,
    TRY: 56.1729,
    AUD: 1.6033,
    BRL: 6.1355,
    CAD: 1.5675,
    CNY: 7.4846,
    HKD: 8.8055,
    IDR: 20281.15,
    ILS: 3.5598,
    INR: 106.0395,
    KRW: 1509.28,
    MXN: 20.8655,
    MYR: 4.5412,
    NZD: 1.9966,
    PHP: 70.706,
    SGD: 1.4336,
    THB: 37.533,
    ZAR: 18.4268,
  },
};
