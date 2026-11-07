/**
 * Numbers in and out of the Calculator. A result is written as the line
 * writes numbers (grouped, the locale's decimal mark, "−" for minus,
 * scientific notation past what 15 digits hold), so it reads back as the same
 * number when the next sum starts from it. Copied, it loses the grouping
 * (`copyNumber`). Pasted text is read as one number the locale's way
 * (`parsePasted`), and refused when it can't be read without guessing.
 */

import { MAX_DIGITS, render, type Token } from "./expression.ts";
import { EN_US, groupDigits, type NumberLocale, numberMarks } from "./locale.ts";

/** At or past these, a result is written in scientific notation. */
const LARGE = 1e15;
const SMALL = 1e-6;

/** A number as tokens: a sign, then its digits ("−1234.5" → −, 1234.5; 1.2e21 → 1.2e21). */
export function numberTokens(value: number): Token[] {
  const abs = Math.abs(value);
  let plain: string;
  if (abs !== 0 && (abs >= LARGE || abs < SMALL)) {
    // Ten significant digits, trailing zeros dropped: 1.234567891e21.
    const [mantissa = "0", exponent = "0"] = abs.toExponential(9).split("e");
    plain = `${mantissa.replace(/\.?0+$/, "")}e${exponent.replace(/^\+/, "")}`;
  } else {
    plain = String(Number(abs.toPrecision(MAX_DIGITS)));
  }
  const match = /^(\d+)(?:\.(\d+))?(e-?\d+)?$/.exec(plain);
  const number: Token = { kind: "number", whole: match?.[1] ?? "0", fraction: match?.[2] ?? null, exponent: match?.[3] ?? "" };
  return value < 0 ? [{ kind: "op", op: "−" }, number] : [number];
}

/** A result as the line and the tape show it: "1,234.5", "−0.33333333333333", "1.2e21" (in the locale's marks). */
export function formatResult(value: number, locale: NumberLocale = EN_US): string {
  return render(numberTokens(value), locale);
}

/**
 * A result for the clipboard: what is shown, without the grouping and with a
 * plain minus ("1234.5", "1234,5", "-2"), so a spreadsheet set to the same
 * region, or the Calculator, reads it back as the same number.
 */
export function copyNumber(value: number, locale: NumberLocale = EN_US): string {
  return render(numberTokens(value), locale, false).replace("−", "-");
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
const NUMBER_RUN = /[-+]?(?:\d|[.,٫]\d)(?:[\d.,٫'’\u00a0\u202f\u2009 ]*\d)?(?:[eE][-+]?\d+)?/g;

/** A number run (from `NUMBER_RUN`) read the locale's way, or null. */
export function readNumber(run: string, locale: NumberLocale = EN_US): number | null {
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
  return readNumber(runs[0] as string, locale);
}

/** Characters that take less room than a digit: the marks, brackets and narrow spaces. */
const NARROW = new Set([",", ".", "٫", "'", "’", " ", "\u00a0", "\u202f", "\u2009", "(", ")"]);

/** About how many ems `text` takes in Inter: a digit or an operator a little over half an em, the marks a third. */
export function textEms(text: string): number {
  return [...text].reduce((sum, char) => sum + (NARROW.has(char) ? 0.3 : 0.62), 0);
}

/**
 * The font size for `text` in a box `width` px wide: `largest`, then smaller
 * as the text grows, so it fits, down to `smallest` (the line then scrolls).
 */
export function fitFontSize(text: string, width: number, largest: number, smallest: number): number {
  const ems = textEms(text);
  if (ems === 0) return largest;
  return Math.max(smallest, Math.min(largest, Math.floor(width / ems)));
}
