/**
 * The answer row: what the launcher works out from the words alone, with no
 * search and nothing fetched. Sums (`2+2`), percentages (`80 + 15%`), units
 * (`5 km in mi`, `20 c in f`, `2 GB in MB`), money at the shipped rates
 * (`100 usd to eur`), and times in other places (`3pm tokyo`, `time in
 * lisbon`). Numbers are read and written in the person's Region. Pure: the
 * clock, the zone and the rates come in the context.
 */

import { calculate } from "../math.ts";
import { type ClockContext, clockAnswer } from "./clock.ts";
import { currencyNamed, exchange, splitSign } from "./currency.ts";
import { canonicalNumbers, copyMoney, copyNumber, numberStyle, showMoney, showNumber } from "./numbers.ts";
import { percentAnswer } from "./percent.ts";
import { RATES, type Rates } from "./rates.ts";
import { convert, unitNamed } from "./units.ts";

export type AnswerKind = "sum" | "unit" | "money" | "time";

export interface Answer {
  kind: AnswerKind;
  /** The row's title, in SemiBold: `= 3.11 mi`, `7:00 AM here`. */
  title: string;
  /** Muted words after it: the sum as typed, where the rates are from. */
  detail: string;
  /** What Enter copies. */
  copy: string;
}

export interface AnswerContext {
  /** The Region's BCP 47 tag (`de-DE`); en-US when unset. */
  locale?: string;
  /** 24-hour time; unset follows the locale. */
  hour24?: boolean;
  /** The zone the person is in; the process's own when unset. */
  timeZone?: string;
  /** Now, in ms; Date.now when unset. */
  now?: number;
  rates?: Rates;
}

/** Longer than this is a sentence, not a sum. */
const MAX_QUERY = 80;
const CONNECTORS = new Set(["in", "to", "as", "into", "=", "->", "→"]);
const AMOUNT = /^(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s*(.*)$/i;

/** The answer to `query`, or null when it isn't something the row works out. */
export function answerFor(query: string, context: AnswerContext = {}): Answer | null {
  const text = query.trim();
  if (!text || text.length > MAX_QUERY) return null;
  const locale = context.locale ?? "en-US";
  const canonical = /\d/.test(text) ? canonicalNumbers(text, numberStyle(locale)) : text;
  if (canonical !== null) {
    const sum = sumAnswer(canonical, text, locale) ?? conversion(canonical, text, locale, context.rates ?? RATES);
    if (sum) return sum;
  }
  const clock: ClockContext = {
    locale,
    timeZone: context.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    now: context.now ?? Date.now(),
    ...(context.hour24 === undefined ? {} : { hour24: context.hour24 }),
  };
  const time = clockAnswer(text, clock);
  return time ? { kind: "time", ...time } : null;
}

function sumAnswer(canonical: string, typed: string, locale: string): Answer | null {
  const percent = percentAnswer(canonical);
  if (percent) {
    const shown = showNumber(percent.value, locale);
    const copied = copyNumber(percent.value, locale);
    return { kind: "sum", title: `= ${shown}${percent.isShare ? "%" : ""}`, detail: typed, copy: `${copied}${percent.isShare ? "%" : ""}` };
  }
  const value = calculate(canonical);
  if (value === null) return null;
  return { kind: "sum", title: `= ${showNumber(value, locale)}`, detail: typed, copy: copyNumber(value, locale) };
}

/** `5 km in mi`, `$20 in eur`: the first split at a connector whose two sides convert. */
function conversion(canonical: string, typed: string, locale: string, rates: Rates): Answer | null {
  const words = canonical.split(/\s+/);
  for (const [at, word] of words.entries()) {
    if (!CONNECTORS.has(word.toLowerCase())) continue;
    const left = words.slice(0, at).join(" ");
    const right = words.slice(at + 1).join(" ");
    if (!left || !right) continue;
    const found = units(left, right, typed, locale) ?? money(left, right, locale, rates);
    if (found) return found;
  }
  return null;
}

/** An amount and the words for what it is: `5 km`, `$20`, `20€`. */
function amountOf(text: string): { amount: number; unit: string } | null {
  const plain = AMOUNT.exec(text);
  if (plain?.[2]) return { amount: Number(plain[1]), unit: plain[2] };
  const signed = splitSign(text);
  if (!signed) return null;
  const amount = AMOUNT.exec(signed[1]);
  return amount && !amount[2] ? { amount: Number(amount[1]), unit: signed[0] } : null;
}

function units(left: string, right: string, typed: string, locale: string): Answer | null {
  const amount = amountOf(left);
  if (!amount) return null;
  const from = unitNamed(amount.unit);
  const to = unitNamed(right);
  if (!from || !to) return null;
  const value = convert(amount.amount, from, to);
  if (value === null || !Number.isFinite(value)) return null;
  const shown = showNumber(value, locale, "measure");
  // "1 days" reads wrong: a plural symbol (days, cups) loses its s at exactly one.
  const symbol = to.symbol.endsWith("s") && shown === showNumber(1, locale) && to.symbol.length > 2 ? to.symbol.slice(0, -1) : to.symbol;
  return { kind: "unit", title: `= ${shown} ${symbol}`, detail: typed, copy: copyNumber(value, locale, "measure") };
}

function money(left: string, right: string, locale: string, rates: Rates): Answer | null {
  const amount = amountOf(left);
  if (!amount) return null;
  const from = currencyNamed(amount.unit, rates);
  const to = currencyNamed(right, rates);
  if (!from || !to) return null;
  const value = exchange(amount.amount, from, to, rates);
  if (value === null || !Number.isFinite(value)) return null;
  return {
    kind: "money",
    title: `= ${showMoney(value, to, locale)}`,
    detail: `${showMoney(amount.amount, from, locale)} · rates from ${rates.date}`,
    copy: copyMoney(value, to, locale),
  };
}
