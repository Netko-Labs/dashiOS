/**
 * The expression line's words: text as the person types it ("1,250 × 12 +
 * 340") read into tokens, written back the tidy way (the locale's grouping,
 * one space around each operator), and worked out. Pure.
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
  const { decimals } = numberMarks(locale);
  const tokens: Token[] = [];
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
  return tokens;
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

export type Outcome =
  /** `value` as shown (15 digits, no noise), `exact` as worked out, for the next sum to go on from. */
  | { kind: "value"; value: number; exact: number }
  /** Nothing to work out yet: an empty line, or an operator still waiting. */
  | { kind: "none" }
  | { kind: "error"; reason: "divide-by-zero" | "too-large" | "malformed" };

/** What one term gives: its value, and the percentage it was when it is a bare one ("10%"), for + and −. */
interface TermValue {
  value: number;
  percent: number | null;
}

class Malformed extends Error {}
class DivideByZero extends Error {}

/** Recursive descent over complete tokens; throws Malformed or DivideByZero. */
function evaluateTokens(tokens: readonly Token[]): number {
  let at = 0;
  const peek = (): Token | undefined => tokens[at];
  const expression = (): number => {
    let value = term().value;
    for (let next = peek(); next?.kind === "op" && (next.op === "+" || next.op === "−"); next = peek()) {
      at += 1;
      const right = term();
      const amount = right.percent === null ? right.value : (value * right.percent) / 100;
      value = next.op === "+" ? value + amount : value - amount;
    }
    return value;
  };
  const term = (): TermValue => {
    let result = unary();
    for (;;) {
      const next = peek();
      if (next?.kind === "op" && (next.op === "×" || next.op === "÷")) {
        at += 1;
        const right = unary().value;
        if (next.op === "÷" && right === 0) throw new DivideByZero();
        result = { value: next.op === "×" ? result.value * right : result.value / right, percent: null };
      } else if (next?.kind === "open" || next?.kind === "number") {
        // 2(3 + 4): a bracket right after a value multiplies.
        if (next.kind === "number") throw new Malformed();
        result = { value: result.value * unary().value, percent: null };
      } else {
        return result;
      }
    }
  };
  const unary = (): TermValue => {
    const next = peek();
    if (next?.kind === "op" && (next.op === "−" || next.op === "+")) {
      at += 1;
      const inner = unary();
      if (next.op === "+") return inner;
      return { value: -inner.value, percent: inner.percent === null ? null : -inner.percent };
    }
    return postfix();
  };
  const postfix = (): TermValue => {
    let value = primary();
    let percent: number | null = null;
    while (peek()?.kind === "percent") {
      at += 1;
      percent = value;
      value /= 100;
    }
    return { value, percent };
  };
  const primary = (): number => {
    const token = peek();
    if (token?.kind === "number") {
      at += 1;
      return Number(`${token.whole}${token.fraction ? `.${token.fraction}` : ""}${token.exponent}`);
    }
    if (token?.kind === "open") {
      at += 1;
      const value = expression();
      if (peek()?.kind !== "close") throw new Malformed();
      at += 1;
      return value;
    }
    throw new Malformed();
  };
  const value = expression();
  if (at !== tokens.length) throw new Malformed();
  return value;
}

/**
 * The tokens with what is still being typed set aside: operators waiting at
 * the end, and brackets left open (closed for it). "12 + " is 12 so far;
 * "(2 + 3" is 5.
 */
export function settled(tokens: readonly Token[]): Token[] {
  const kept = [...tokens];
  while (kept.length > 0 && (kept.at(-1)?.kind === "op" || kept.at(-1)?.kind === "open")) kept.pop();
  let depth = 0;
  for (const token of kept) {
    if (token.kind === "open") depth += 1;
    if (token.kind === "close") depth -= 1;
  }
  return [...kept, ...Array.from({ length: Math.max(0, depth) }, (): Token => ({ kind: "close" }))];
}

/** A result as a double keeps it without its noise: 0.1 + 0.2 is 0.3, not 0.30000000000000004. */
export function tidy(value: number): number {
  return Number(value.toPrecision(MAX_DIGITS));
}

/** The line worked out so far (`settled`), or why it can't be. */
export function evaluate(tokens: readonly Token[]): Outcome {
  const ready = settled(tokens);
  if (ready.length === 0) return { kind: "none" };
  try {
    const value = evaluateTokens(ready);
    if (!Number.isFinite(value) || Math.abs(value) > 1e300) return { kind: "error", reason: "too-large" };
    return { kind: "value", value: Object.is(tidy(value), -0) ? 0 : tidy(value), exact: Object.is(value, -0) ? 0 : value };
  } catch (error) {
    return { kind: "error", reason: error instanceof DivideByZero ? "divide-by-zero" : "malformed" };
  }
}

/** Whether the tokens ask for any working out: an operator between values, or a %. A lone number (−5 too) does not. */
export function hasOperation(tokens: readonly Token[]): boolean {
  return tokens.some((token, index) => token.kind === "percent" || (token.kind === "op" && !isSign(tokens, index)));
}

/** What = does again after an =: the last operator at the top level and the number after it ("2 + 3" → "+ 3"). */
export function repeatOf(tokens: readonly Token[]): Token[] | null {
  let depth = 0;
  let last = -1;
  tokens.forEach((token, index) => {
    if (token.kind === "open") depth += 1;
    else if (token.kind === "close") depth -= 1;
    else if (token.kind === "op" && depth === 0 && !isSign(tokens, index)) last = index;
  });
  if (last < 0) return null;
  const operand = tokens.slice(last + 1);
  const isNumber = operand.length === 1 && operand[0]?.kind === "number";
  const isSigned = operand.length === 2 && operand[0]?.kind === "op" && operand[0].op === "−" && operand[1]?.kind === "number";
  return isNumber || isSigned ? tokens.slice(last) : null;
}
