/**
 * The expression line worked out: its tokens (expression.ts) to a value, or
 * why there is none. Pure; expression.ts's header has the sums' rules.
 */

import { isSign, MAX_DIGITS, type Token } from "./expression.ts";

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
