/**
 * The keypad's keys and the keyboard's: which key a typed character is (so
 * the keypad lights it), and what a key types into the line. The keyboard:
 * digits; the locale's decimal mark (and "." or "," when the locale doesn't
 * group with it); + - * x / for the operators; %; ( ); = or Return to work
 * it out; n for ±; Esc to clear; ↑ ↓ for the sums on the tape; ⌫ and ⌦ and
 * the arrows as in any field (KB-6).
 */

import { operatorFor } from "./expression.ts";
import { type NumberLocale, numberMarks } from "./locale.ts";

export type KeyId =
  | "0"
  | "1"
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "decimal"
  | "plus"
  | "minus"
  | "multiply"
  | "divide"
  | "percent"
  | "negate"
  | "clear"
  | "equals";

const OPERATOR_KEYS = { "+": "plus", "−": "minus", "×": "multiply", "÷": "divide" } as const;

/** The key a typed character is, or null (a bracket, a letter). */
export function keyForChar(char: string, locale: NumberLocale): KeyId | null {
  if (/^[0-9]$/.test(char)) return char as KeyId;
  if (numberMarks(locale).decimals.has(char)) return "decimal";
  if (char === "%") return "percent";
  if (char === "=") return "equals";
  if (char === "n" || char === "N") return "negate";
  const op = operatorFor(char);
  return op ? OPERATOR_KEYS[op] : null;
}

/** What a key types into the line, for the keys that type (not =, ±, C). */
export function charForKey(id: KeyId, locale: NumberLocale): string | null {
  switch (id) {
    case "decimal":
      return locale.decimal;
    case "plus":
      return "+";
    case "minus":
      return "−";
    case "multiply":
      return "×";
    case "divide":
      return "÷";
    case "percent":
      return "%";
    case "negate":
    case "clear":
    case "equals":
      return null;
    default:
      return id;
  }
}
