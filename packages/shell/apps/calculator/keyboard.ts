/**
 * The Calculator's keyboard: what a key (from the kit's KeySink) presses.
 * Digits; the locale's decimal mark for the point (and "." or "," when the
 * locale doesn't group with it: the numeric keypad's key types either); + - *
 * x / for the operators; = or Enter; %; Backspace; Esc (or c) to clear. The
 * locale's grouping mark does nothing: the display groups by itself, so
 * typing "1,000" in English gives 1,000.
 *
 * Paste: Ctrl+V reaches the sink as text, and it goes the way ❖V does
 * (view.tsx): the text is read as one number (`parsePasted`), and text that
 * isn't one is ignored, never typed key by key. The sink can't tell a paste
 * of one character from typing it, so pasting "c" still clears.
 */

import type { KeyInput } from "@dashi/ui";
import type { CalcKey } from "./engine.ts";
import { numberMarks, parsePasted } from "./format.ts";
import { EN_US, type NumberLocale } from "./locale.ts";

export function keyForChar(char: string, locale: NumberLocale = EN_US): CalcKey | null {
  if (/^[0-9]$/.test(char)) return { kind: "digit", digit: char };
  if (numberMarks(locale).decimals.has(char)) return { kind: "decimal" };
  switch (char) {
    case "+":
      return { kind: "operator", op: "+" };
    case "-":
    case "−":
      return { kind: "operator", op: "-" };
    case "*":
    case "x":
    case "X":
    case "×":
      return { kind: "operator", op: "×" };
    case "/":
    case "÷":
      return { kind: "operator", op: "÷" };
    case "=":
      return { kind: "equals" };
    case "%":
      return { kind: "percent" };
    case "c":
    case "C":
      return { kind: "clear" };
    default:
      return null;
  }
}

/** What pasted text presses: the number it holds, or nothing. */
export function pasteKeys(text: string, locale: NumberLocale = EN_US): CalcKey[] {
  const value = parsePasted(text, locale);
  return value === null ? [] : [{ kind: "number", value }];
}

export function calcKeysFor(input: KeyInput, locale: NumberLocale = EN_US): CalcKey[] {
  switch (input.kind) {
    case "enter":
      return [{ kind: "equals" }];
    case "escape":
      return [{ kind: "clear" }];
    case "backspace":
      return [{ kind: "backspace" }];
    case "up":
    case "down":
      return [];
    case "text": {
      const chars = [...input.text];
      // More than one character in one change is a paste (Ctrl+V): a number, or nothing.
      if (chars.length > 1) return pasteKeys(input.text, locale);
      const key = chars[0] === undefined ? null : keyForChar(chars[0], locale);
      return key ? [key] : [];
    }
  }
}
