/**
 * The launcher's math, as Spotlight does it: `2+3*4`, `(4+5)/3`, `2^10`,
 * `-3 x 7`, `15%`. × and ÷ bind tighter than + and −, ^ tighter still (and
 * to the right); `%` is a hundredth. A query is math only when it has an
 * operator between numbers (a lone `42` is a search), and anything else in
 * it (a letter, a stray bracket) makes it not math at all.
 */

type Token = { kind: "number"; value: number } | { kind: "op"; op: string };

const OPERATORS = new Set(["+", "-", "*", "/", "^", "%", "(", ")"]);
const SPELLINGS: Readonly<Record<string, string>> = { x: "*", "×": "*", "÷": "/", "−": "-" };

function tokenize(query: string): Token[] | null {
  const tokens: Token[] = [];
  let at = 0;
  while (at < query.length) {
    const char = query[at] ?? "";
    if (/\s/.test(char)) {
      at += 1;
      continue;
    }
    const number = /^(?:\d+(?:\.\d*)?|\.\d+)/.exec(query.slice(at));
    if (number) {
      tokens.push({ kind: "number", value: Number(number[0]) });
      at += number[0].length;
      continue;
    }
    const op = SPELLINGS[char.toLowerCase()] ?? char;
    if (!OPERATORS.has(op)) return null;
    tokens.push({ kind: "op", op });
    at += 1;
  }
  return tokens;
}

/** Recursive descent over the tokens; NaN for anything malformed. */
function evaluate(tokens: readonly Token[]): number {
  let at = 0;
  const peek = (): string | null => {
    const token = tokens[at];
    return token?.kind === "op" ? token.op : null;
  };
  const expression = (): number => {
    let value = term();
    for (let op = peek(); op === "+" || op === "-"; op = peek()) {
      at += 1;
      const right = term();
      value = op === "+" ? value + right : value - right;
    }
    return value;
  };
  const term = (): number => {
    let value = unary();
    for (let op = peek(); op === "*" || op === "/"; op = peek()) {
      at += 1;
      const right = unary();
      value = op === "*" ? value * right : right === 0 ? Number.NaN : value / right;
    }
    return value;
  };
  const unary = (): number => {
    const op = peek();
    if (op === "-" || op === "+") {
      at += 1;
      const value = unary();
      return op === "-" ? -value : value;
    }
    return power();
  };
  const power = (): number => {
    const base = percent();
    if (peek() !== "^") return base;
    at += 1;
    // Right to left, and an exponent may be negative: 2^-1.
    return base ** unary();
  };
  const percent = (): number => {
    let value = atom();
    while (peek() === "%") {
      at += 1;
      value /= 100;
    }
    return value;
  };
  const atom = (): number => {
    const token = tokens[at];
    if (token?.kind === "number") {
      at += 1;
      return token.value;
    }
    if (token?.kind === "op" && token.op === "(") {
      at += 1;
      const value = expression();
      if (peek() !== ")") return Number.NaN;
      at += 1;
      return value;
    }
    return Number.NaN;
  };
  const value = expression();
  return at === tokens.length ? value : Number.NaN;
}

/** The answer to `query` when it is math, else null (a search, a division by zero, a number too large). */
export function calculate(query: string): number | null {
  const tokens = tokenize(query);
  if (!tokens) return null;
  const numbers = tokens.filter((token) => token.kind === "number").length;
  // Something to work out: an operator, and a number for it (`-5` and `42` are searches; `50%` is math).
  const working = tokens.some((token) => token.kind === "op" && token.op !== "(" && token.op !== ")");
  const isMath = numbers >= 2 || (numbers === 1 && tokens.some((token) => token.kind === "op" && token.op === "%"));
  if (!working || !isMath) return null;
  const result = evaluate(tokens);
  return Number.isFinite(result) ? Number(result.toFixed(8)) : null;
}
