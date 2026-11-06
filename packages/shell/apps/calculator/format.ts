/**
 * What the Calculator's display shows: a number typed (as typed, grouped),
 * or a result rounded to the nine digits the display holds, grouped the
 * locale's way, in scientific notation when it is too large or too small for
 * those digits. And the other way: text pasted into the Calculator, read as
 * one number the locale's way (`parsePasted`).
 *
 * The engine keeps numbers with "." as the decimal point; only what is shown,
 * copied, and pasted uses the locale's marks (locale.ts).
 */

import type { CalcState } from "./engine.ts";
import { MAX_DIGITS } from "./engine.ts";
import { EN_US, groupDigits, type NumberLocale } from "./locale.ts";

/** "1234.5" (engine spelling) → the locale's: "1,234.5", "1.234,5". The integer digits are grouped; the rest is kept. */
function localize(plain: string, locale: NumberLocale): string {
  const negative = plain.startsWith("-");
  const body = negative ? plain.slice(1) : plain;
  const dot = body.indexOf(".");
  const whole = dot < 0 ? body : body.slice(0, dot);
  const fraction = dot < 0 ? "" : `${locale.decimal}${body.slice(dot + 1)}`;
  return `${negative ? "-" : ""}${groupDigits(whole || "0", locale)}${fraction}`;
}

/** A typed entry, kept as typed (trailing zeros, a trailing point) and grouped: "-1,234.50", "-1.234,50". */
export function formatTyped(typed: string, locale: NumberLocale = EN_US): string {
  return localize(typed, locale);
}

/** Scientific notation with up to `digits` significant digits, trailing zeros dropped: "1.234568e15". */
function scientific(value: number, digits: number, locale: NumberLocale): string {
  const [mantissa = "0", exponent = "0"] = value.toExponential(digits - 1).split("e");
  const trimmed = mantissa.includes(".") ? mantissa.replace(/0+$/, "").replace(/\.$/, "") : mantissa;
  return `${trimmed.replace(".", locale.decimal)}e${exponent.replace(/^\+/, "")}`;
}

/** A result, in at most `maxDigits` digits: "1,234,567.89", "0.33333333", "1.234568e15" (in the locale's marks). */
export function formatNumber(value: number, locale: NumberLocale = EN_US, maxDigits: number = MAX_DIGITS): string {
  if (!Number.isFinite(value)) return "Error";
  if (value === 0) return "0";
  const abs = Math.abs(value);
  const whole = Math.floor(abs);
  const wholeDigits = whole === 0 ? 1 : String(whole).length;
  if (abs >= 10 ** maxDigits) return scientific(value, maxDigits - 2, locale);
  const decimals = Math.max(0, maxDigits - wholeDigits);
  let fixed = abs.toFixed(decimals);
  // Rounding up can add a digit (999999999.6); a tiny number can round to nothing.
  if (Number(fixed) >= 10 ** maxDigits) return scientific(value, maxDigits - 2, locale);
  if (Number(fixed) === 0) return scientific(value, maxDigits - 3, locale);
  if (fixed.includes(".")) fixed = fixed.replace(/0+$/, "").replace(/\.$/, "");
  return localize(`${value < 0 ? "-" : ""}${fixed}`, locale);
}

/** The display's text for a state. */
export function displayText(state: CalcState, locale: NumberLocale = EN_US): string {
  if (state.error) return "Error";
  return state.typed !== null ? formatTyped(state.typed, locale) : formatNumber(state.value, locale);
}

/**
 * The display's number as text for the clipboard: no grouping, the locale's
 * decimal mark ("1234.5", "1234,5", "1.2e+21"), so pasting it back, here or
 * in a spreadsheet set to the same region, reads the same number.
 */
export function copyText(state: CalcState, locale: NumberLocale = EN_US): string {
  if (state.error) return "";
  const plain = state.typed !== null ? (state.typed === "-" ? "0" : state.typed.replace(/\.$/, "")) : String(Number(state.value.toPrecision(15)));
  return plain.replace(".", locale.decimal);
}

/** Spaces and apostrophes group digits in some locales and are never a decimal mark in any. */
const NEUTRAL_GROUPS = [" ", " ", " ", " ", "'", "’"];

/** The marks a number may use in `locale`: its decimal marks, and the marks that group digits. */
export function numberMarks(locale: NumberLocale): { decimals: ReadonlySet<string>; groups: ReadonlySet<string> } {
  const groups = new Set([locale.group, ...NEUTRAL_GROUPS]);
  groups.delete(locale.decimal);
  // "." and "," both mean the decimal point unless one of them is the locale's grouping.
  const decimals = new Set([locale.decimal, ...[".", ","].filter((mark) => !groups.has(mark))]);
  return { decimals, groups };
}

/** Whether the locale groups by two after the first three (en-IN's 12,34,567). */
const groupsByTwo = (locale: NumberLocale): boolean => /\d\D\d{2}\D\d{3}$/.test(groupDigits("1234567", locale));

/** "1,234,567" (split at its group marks) as digits, or null when the groups are not well formed. */
function ungroup(whole: string, groups: ReadonlySet<string>, locale: NumberLocale): string | null {
  const used = [...whole].filter((char) => groups.has(char));
  if (used.length === 0) return /^\d+$/.test(whole) ? whole : null;
  // One kind of group mark; a first group of one to three digits that is not a leading zero; then threes (or twos, then a three, in en-IN).
  if (new Set(used).size > 1) return null;
  const parts = whole.split(used[0] as string);
  const [first = "", ...rest] = parts;
  if (!/^[1-9]\d{0,2}$/.test(first)) return null;
  const last = rest.pop() ?? "";
  if (!/^\d{3}$/.test(last)) return null;
  const middle = groupsByTwo(locale) ? /^\d{2,3}$/ : /^\d{3}$/;
  if (!rest.every((part) => middle.test(part))) return null;
  return parts.join("");
}

/** One run of text that looks like a number: a sign, digits with marks between them, an exponent. */
const NUMBER_RUN = /[-+]?(?:\d|[.,٫]\d)(?:[\d.,٫'’    ]*\d)?(?:[eE][-+]?\d+)?/g;

/** A number run (from `NUMBER_RUN`) read the locale's way, or null. */
function readRun(run: string, locale: NumberLocale): number | null {
  const { decimals, groups } = numberMarks(locale);
  const exponentAt = run.search(/[eE]/);
  const mantissa = exponentAt < 0 ? run : run.slice(0, exponentAt);
  const exponent = exponentAt < 0 ? "" : run.slice(exponentAt);
  const sign = mantissa.startsWith("-") ? "-" : "";
  const body = /^[-+]/.test(mantissa) ? mantissa.slice(1) : mantissa;
  const decimalMarks = [...body].filter((char) => decimals.has(char));
  if (decimalMarks.length > 1) return null;
  const point = decimalMarks.length === 1 ? body.indexOf(decimalMarks[0] as string) : -1;
  const whole = point < 0 ? body : body.slice(0, point);
  const fraction = point < 0 ? "" : body.slice(point + 1);
  if (!/^\d*$/.test(fraction)) return null;
  const digits = whole === "" ? "0" : ungroup(whole, groups, locale);
  if (digits === null) return null;
  const value = Number(`${sign}${digits}${fraction ? `.${fraction}` : ""}${exponent}`);
  return Number.isFinite(value) ? value : null;
}

/**
 * Pasted text as a number, or null. The text may say more than the number
 * ("Total: 1,234.50", "1.234,50 €"), but it must hold exactly one: two
 * numbers, or a number whose marks the locale would not write ("1,5" where ","
 * groups thousands, "1.234,5" where "." is the decimal point), are refused
 * rather than guessed at. A leading minus (or a Unicode minus) is a sign, and
 * "1e3" works.
 */
export function parsePasted(text: string, locale: NumberLocale = EN_US): number | null {
  const normalized = text.replace(/[−–]/g, "-").trim();
  const runs = normalized.match(NUMBER_RUN) ?? [];
  if (runs.length !== 1) return null;
  return readRun(runs[0] as string, locale);
}

/** Characters that take less room than a digit: the marks and narrow spaces. */
const NARROW = new Set([",", ".", "٫", "'", "’", " ", " ", " ", " "]);

/**
 * The display's font size for `text` in a display `width` px wide: large, then
 * smaller as digits are added, so a full display still fits.
 */
export function displayFontSize(text: string, width: number, largest = 52, smallest = 22): number {
  // Inter's digits average a little over half an em; separators and narrow spaces about a third.
  const ems = [...text].reduce((sum, char) => sum + (NARROW.has(char) ? 0.3 : 0.6), 0);
  if (ems === 0) return largest;
  return Math.max(smallest, Math.min(largest, Math.floor(width / ems)));
}
