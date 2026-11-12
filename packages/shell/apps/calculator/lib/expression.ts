/**
 * The expression line's words: text as the person types it ("1,250 × 12 +
 * 340") read into tokens and written back the tidy way (the locale's
 * grouping, one space around each operator). evaluate.ts works them out. Pure.
 *
 * - × and ÷ bind tighter than + and −: 2 + 3 × 4 = 14. Brackets group.
 * - % is a percentage of what it is added to or taken from (200 + 10% =
 *   220), otherwise a hundredth (50 × 10% = 5).
 * - Reading is forgiving, as typing is: the locale's grouping marks and
 *   spaces are not part of the sum (the line groups by itself), "*" "x" "/"
 *   "-" are × ÷ −, and anything else is left out. A paste is stricter
 *   (line.ts).
 * - A number holds at most 15 digits, what a double keeps exactly.
 */

import { groupDigits, type NumberLocale, numberMarks } from "./locale.ts";

export type Operator = "+" | "−" | "×" | "÷";

export type Token =
  | {
      kind: "number";
      /** Integer digits, no leading zeros ("0" for none). */
      whole: string;
      /** Digits after the decimal mark; "" when the mark ends the number ("12."), null with no mark. */
      fraction: string | null;
      /** "e21", "e-7", or "". */
      exponent: string;
    }
  | { kind: "op"; op: Operator }
  | { kind: "percent" }
  | { kind: "open" }
  | { kind: "close" };

/** Digits a number may hold. */
export const MAX_DIGITS = 15;

const SPELLINGS: Readonly<Record<string, Operator>> = {
  "+": "+",
  "-": "−",
  "–": "−",
  "−": "−",
  "*": "×",
  x: "×",
  X: "×",
  "×": "×",
  "·": "×",
  "/": "÷",
  "÷": "÷",
};

/** The operator a typed character means, if any. */
export function operatorFor(char: string): Operator | null {
  return SPELLINGS[char] ?? null;
}

/** Characters that carry no meaning in a sum: spaces and the locale's grouping marks. */
export function isQuiet(char: string, locale: NumberLocale): boolean {
  return /\s/u.test(char) || numberMarks(locale).groups.has(char);
}

const EXPONENT = /^[eE]([-+−]?)(\d+)/;

/** Text read into tokens, the forgiving way (see the header). */
export function tokenize(text: string, locale: NumberLocale): Token[] {
  return read(text, locale).tokens;
}

/**
 * Whether `text` holds a number with more digits than one may hold. Reading
 * leaves the digits past the fifteenth out, which for a whole number is a
 * different number (a tenth of it), so the line refuses an edit that would
 * make one instead of showing what was not typed (line.ts, `settle`).
 */
export function overflows(text: string, locale: NumberLocale): boolean {
  return read(text, locale).dropped;
}

function read(text: string, locale: NumberLocale): { tokens: Token[]; dropped: boolean } {
  const { decimals } = numberMarks(locale);
  const tokens: Token[] = [];
  let dropped = false;
  let number: { whole: string; fraction: string | null; exponent: string } | null = null;
  const end = (): void => {
    if (!number) return;
    tokens.push({ kind: "number", whole: number.whole.replace(/^0+(?=\d)/, "") || "0", fraction: number.fraction, exponent: number.exponent });
    number = null;
  };
  const chars = [...text];
  for (let at = 0; at < chars.length; at += 1) {
    const char = chars[at] as string;
    if (isQuiet(char, locale)) continue;
    if (/^[0-9]$/.test(char) || decimals.has(char)) {
      number ??= { whole: "", fraction: null, exponent: "" };
      if (number.exponent) {
        // Digits after an exponent start a new number.
        end();
        number = { whole: "", fraction: null, exponent: "" };
      }
      // Leading zeros hold no digit of the value: 0.333333333333333 has 15.
      const digits = number.whole.replace(/^0+/, "").length + (number.fraction?.length ?? 0);
      if (decimals.has(char)) {
        if (number.fraction === null) number.fraction = "";
      } else if (digits < MAX_DIGITS) {
        if (number.fraction === null) number.whole += char;
        else number.fraction += char;
      } else if (number.fraction !== null || char !== "0" || digits > 0) {
        // A zero before the first digit of a whole number holds nothing; any other digit here is one too many.
        dropped = true;
      }
      continue;
    }
    if ((char === "e" || char === "E") && number && !number.exponent) {
      const exponent = EXPONENT.exec(chars.slice(at).join(""));
      if (exponent) {
        number.exponent = `e${exponent[1] === "-" || exponent[1] === "−" ? "-" : ""}${exponent[2]}`;
        at += exponent[0].length - 1;
        continue;
      }
    }
    end();
    const op = operatorFor(char);
    if (op) tokens.push({ kind: "op", op });
    else if (char === "%") tokens.push({ kind: "percent" });
    else if (char === "(") tokens.push({ kind: "open" });
    else if (char === ")") tokens.push({ kind: "close" });
  }
  end();
  return { tokens, dropped };
}

/** Whether the operator at `index` is a sign (−5, × −2, (−3)) rather than between two values. */
export function isSign(tokens: readonly Token[], index: number): boolean {
  const before = tokens[index - 1];
  return before === undefined || before.kind === "op" || before.kind === "open";
}

/** A number token in the locale's marks: grouped ("1,234.5"), or plain for storing ("1234.5"). */
export function writeNumber(token: Extract<Token, { kind: "number" }>, locale: NumberLocale, grouped = true): string {
  const whole = grouped ? groupDigits(token.whole, locale) : token.whole;
  const fraction = token.fraction === null ? "" : `${locale.decimal}${token.fraction}`;
  return `${whole}${fraction}${token.exponent}`;
}

/** Tokens written the tidy way: "1,250 × 12 + 340", "−5 × (2 + 3)", "200 + 10%". */
export function render(tokens: readonly Token[], locale: NumberLocale, grouped = true): string {
  let text = "";
  tokens.forEach((token, index) => {
    switch (token.kind) {
      case "number":
        text += writeNumber(token, locale, grouped);
        break;
      case "op":
        if (isSign(tokens, index)) {
          // A sign sits on its number; after an operator it is set off from it: "3 × −2".
          if (token.op === "−") text += "−";
        } else {
          text = text ? `${text.trimEnd()} ${token.op} ` : `${token.op} `;
        }
        break;
      case "percent":
        text += "%";
        break;
      case "open":
        text += "(";
        break;
      case "close":
        text = `${text.trimEnd()})`;
        break;
    }
  });
  return text.trimEnd();
}
