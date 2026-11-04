/**
 * What the Calculator's display shows: a number typed (as typed, grouped),
 * or a result rounded to the nine digits the display holds, grouped by
 * thousands, in scientific notation when it is too large or too small for
 * those digits. And the other way: text pasted into the Calculator as a number.
 */

import type { CalcState } from "./engine.ts";
import { MAX_DIGITS } from "./engine.ts";

/** "1234567" → "1,234,567" (the integer digits only). */
function group(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** A typed entry, kept as typed (trailing zeros, a trailing point) and grouped: "-1,234.50". */
export function formatTyped(typed: string): string {
  const negative = typed.startsWith("-");
  const body = negative ? typed.slice(1) : typed;
  const dot = body.indexOf(".");
  const whole = dot < 0 ? body : body.slice(0, dot);
  const fraction = dot < 0 ? "" : body.slice(dot);
  return `${negative ? "-" : ""}${group(whole || "0")}${fraction}`;
}

/** Scientific notation with up to `digits` significant digits, trailing zeros dropped: "1.234568e15". */
function scientific(value: number, digits: number): string {
  const [mantissa = "0", exponent = "0"] = value.toExponential(digits - 1).split("e");
  const trimmed = mantissa.includes(".") ? mantissa.replace(/0+$/, "").replace(/\.$/, "") : mantissa;
  return `${trimmed}e${exponent.replace(/^\+/, "")}`;
}

/** A result, in at most `MAX_DIGITS` digits: "1,234,567.89", "0.33333333", "1.234568e15". */
export function formatNumber(value: number, maxDigits: number = MAX_DIGITS): string {
  if (!Number.isFinite(value)) return "Error";
  if (value === 0) return "0";
  const abs = Math.abs(value);
  const whole = Math.floor(abs);
  const wholeDigits = whole === 0 ? 1 : String(whole).length;
  if (abs >= 10 ** maxDigits) return scientific(value, maxDigits - 2);
  const decimals = Math.max(0, maxDigits - wholeDigits);
  let fixed = abs.toFixed(decimals);
  // Rounding up can add a digit (999999999.6); a tiny number can round to nothing.
  if (Number(fixed) >= 10 ** maxDigits) return scientific(value, maxDigits - 2);
  if (Number(fixed) === 0) return scientific(value, maxDigits - 3);
  if (fixed.includes(".")) fixed = fixed.replace(/0+$/, "").replace(/\.$/, "");
  const dot = fixed.indexOf(".");
  const intPart = dot < 0 ? fixed : fixed.slice(0, dot);
  const fraction = dot < 0 ? "" : fixed.slice(dot);
  return `${value < 0 ? "-" : ""}${group(intPart)}${fraction}`;
}

/** The display's text for a state. */
export function displayText(state: CalcState): string {
  if (state.error) return "Error";
  return state.typed !== null ? formatTyped(state.typed) : formatNumber(state.value);
}

/** The display's number as plain text for the clipboard: no grouping ("1234.5", "1.2e+21"). */
export function copyText(state: CalcState): string {
  if (state.error) return "";
  if (state.typed !== null) return state.typed === "-" ? "0" : state.typed.replace(/\.$/, "");
  return String(Number(state.value.toPrecision(15)));
}

/**
 * Pasted text as a number, or null: grouping commas and spaces are ignored,
 * a leading minus or a Unicode minus is a sign, "1e3" works. Anything else
 * (letters, two numbers) is not a number.
 */
export function parsePasted(text: string): number | null {
  const cleaned = text
    .trim()
    .replace(/[\s,_]/g, "")
    .replace(/^[−–]/, "-");
  if (!/^-?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

/**
 * The display's font size for `text` in a display `width` px wide: large, then
 * smaller as digits are added, so a full display still fits (the Mac shrinks too).
 */
export function displayFontSize(text: string, width: number, largest = 52, smallest = 22): number {
  // Inter's digits and separators average a little over half an em.
  const ems = [...text].reduce((sum, char) => sum + (char === "," || char === "." ? 0.3 : 0.6), 0);
  if (ems === 0) return largest;
  return Math.max(smallest, Math.min(largest, Math.floor(width / ems)));
}
