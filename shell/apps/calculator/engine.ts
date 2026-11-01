/**
 * The Calculator's arithmetic, as the Mac's basic calculator does it, with
 * no UI: a pure reducer from a state and a key to the next state.
 *
 * - × and ÷ bind tighter than + and −: 2 + 3 × 4 = 14. Pressing an operator
 *   works out what it can (2 × 3 + shows 6; 2 + 3 × keeps 3, waiting).
 * - Two operators in a row: the second replaces the first.
 * - = repeats: 2 + 3 = = gives 5, 8; a number typed after = takes the place
 *   of the result (2 + 3 = 7 = gives 10). With an operator still waiting, =
 *   uses the shown number twice (5 × = gives 25).
 * - % is a percentage of what it is added to (200 + 10 % = 220), otherwise
 *   a hundredth (50 × 10 % = 5).
 * - C clears the number being typed and the key turns into AC, which clears
 *   everything.
 * - Dividing by zero, or a result too large to be a number, shows Error
 *   until the next digit or AC.
 */

export type Operator = "+" | "-" | "×" | "÷";

export type CalcKey =
  | { kind: "digit"; digit: string }
  | { kind: "decimal" }
  | { kind: "operator"; op: Operator }
  | { kind: "equals" }
  | { kind: "percent" }
  | { kind: "negate" }
  /** C then AC: the label the key shows says which (`clearLabel`). */
  | { kind: "clear" }
  | { kind: "backspace" }
  /** A number from outside (a paste). */
  | { kind: "number"; value: number };

interface Pending {
  left: number;
  op: Operator;
}

export interface CalcState {
  /** The number being typed, as typed ("0.50", "-12"); null when the display shows `value`. */
  typed: string | null;
  /** What the display shows when nothing is being typed: a result, or an operand. */
  value: number;
  /** A number has been given since the last operator (typed, or made by % or ±). */
  hasOperand: boolean;
  /** A + or − waiting for its right side. */
  add: Pending | null;
  /** A × or ÷ waiting for its right side. */
  mul: Pending | null;
  /** The operator just pressed, still waiting for a number: the key shows as chosen. */
  awaiting: Operator | null;
  /** What = does again after an =. */
  repeat: { op: Operator; operand: number } | null;
  error: boolean;
}

/** Digits a typed number may have, as on the Mac's basic calculator. */
export const MAX_DIGITS = 9;

export const INITIAL: CalcState = {
  typed: null,
  value: 0,
  hasOperand: false,
  add: null,
  mul: null,
  awaiting: null,
  repeat: null,
  error: false,
};

const ERROR: CalcState = { ...INITIAL, error: true };

export function apply(left: number, op: Operator, right: number): number {
  switch (op) {
    case "+":
      return left + right;
    case "-":
      return left - right;
    case "×":
      return left * right;
    case "÷":
      return right === 0 ? Number.NaN : left / right;
  }
}

const isMul = (op: Operator): boolean => op === "×" || op === "÷";

/** The number on display. */
export function current(state: CalcState): number {
  if (state.typed === null) return state.value;
  const value = Number(state.typed === "-" ? "0" : state.typed);
  return Number.isFinite(value) ? value : 0;
}

/** A computed number becomes the shown value, or Error when it is not a number. */
function show(state: CalcState, value: number, patch: Partial<CalcState>): CalcState {
  if (!Number.isFinite(value)) return ERROR;
  return { ...state, ...patch, typed: null, value: Object.is(value, -0) ? 0 : value };
}

function digitCount(typed: string): number {
  return typed.replace(/[^0-9]/g, "").length;
}

function typeDigit(state: CalcState, digit: string): CalcState {
  const fresh = state.error ? INITIAL : state;
  const typed = fresh.typed;
  if (typed === null) return { ...fresh, typed: digit, hasOperand: true, awaiting: null };
  if (digitCount(typed) >= MAX_DIGITS) return fresh;
  // A leading zero is replaced, not kept ("0" then "5" is "5"; "-0" then "5" is "-5").
  if (typed === "0") return { ...fresh, typed: digit };
  if (typed === "-0") return { ...fresh, typed: `-${digit}` };
  return { ...fresh, typed: typed + digit };
}

function typeDecimal(state: CalcState): CalcState {
  const fresh = state.error ? INITIAL : state;
  const typed = fresh.typed;
  if (typed === null) return { ...fresh, typed: "0.", hasOperand: true, awaiting: null };
  if (typed.includes(".") || digitCount(typed) >= MAX_DIGITS) return fresh;
  return { ...fresh, typed: `${typed}.` };
}

function pressOperator(state: CalcState, op: Operator): CalcState {
  if (state.error) return state;
  // Another operator right after one: it takes that one's place.
  if (!state.hasOperand && state.awaiting !== null) {
    if (isMul(op) && state.mul) return { ...state, mul: { ...state.mul, op }, awaiting: op };
    if (!isMul(op) && state.add && !state.mul) return { ...state, add: { ...state.add, op }, awaiting: op };
    if (!isMul(op) && state.mul) {
      // × then +: the multiplication had no right side yet, so it is dropped and its left side joins the sum.
      let left = state.mul.left;
      if (state.add) left = apply(state.add.left, state.add.op, left);
      if (!Number.isFinite(left)) return ERROR;
      return show(state, left, { mul: null, add: { left, op }, awaiting: op, hasOperand: false });
    }
    // + then ×: the sum's right side becomes the product's left.
    if (isMul(op) && state.add && !state.mul) {
      return { ...state, add: null, mul: { left: state.add.left, op }, awaiting: op };
    }
  }
  let x = current(state);
  if (isMul(op)) {
    if (state.mul) x = apply(state.mul.left, state.mul.op, x);
    if (!Number.isFinite(x)) return ERROR;
    return show(state, x, { mul: { left: x, op }, awaiting: op, hasOperand: false, repeat: null });
  }
  if (state.mul) x = apply(state.mul.left, state.mul.op, x);
  if (state.add) x = apply(state.add.left, state.add.op, x);
  if (!Number.isFinite(x)) return ERROR;
  return show(state, x, { mul: null, add: { left: x, op }, awaiting: op, hasOperand: false, repeat: null });
}

function pressEquals(state: CalcState): CalcState {
  if (state.error) return state;
  const x = current(state);
  if (state.add || state.mul) {
    let result = x;
    let repeat: CalcState["repeat"] = null;
    if (state.mul) {
      result = apply(state.mul.left, state.mul.op, x);
      repeat = { op: state.mul.op, operand: x };
    }
    if (state.add) {
      if (!state.mul) repeat = { op: state.add.op, operand: x };
      result = apply(state.add.left, state.add.op, result);
    }
    return show(state, result, { add: null, mul: null, awaiting: null, hasOperand: false, repeat });
  }
  if (state.repeat) {
    return show(state, apply(x, state.repeat.op, state.repeat.operand), { awaiting: null, hasOperand: false });
  }
  return show(state, x, { awaiting: null, hasOperand: false });
}

function pressPercent(state: CalcState): CalcState {
  if (state.error) return state;
  const x = current(state);
  // Of the left side of a sum (200 + 10 % is 20); a hundredth otherwise.
  const value = state.add && !state.mul ? (state.add.left * x) / 100 : x / 100;
  return show(state, value, { hasOperand: true, awaiting: null });
}

function pressNegate(state: CalcState): CalcState {
  if (state.error) return state;
  if (state.typed !== null) {
    return { ...state, typed: state.typed.startsWith("-") ? state.typed.slice(1) : `-${state.typed}` };
  }
  // Right after an operator there is no number yet: start typing a negative one.
  if (state.awaiting !== null) return { ...state, typed: "-0", hasOperand: true, awaiting: null };
  return show(state, -state.value, { hasOperand: true });
}

function pressClear(state: CalcState): CalcState {
  if (clearLabel(state) === "AC") return INITIAL;
  // C: the number being given goes; what was waiting stays.
  return { ...state, typed: null, value: 0, hasOperand: false, error: false, awaiting: null };
}

function pressBackspace(state: CalcState): CalcState {
  if (state.error) return INITIAL;
  if (state.typed === null) return state;
  const shorter = state.typed.slice(0, -1);
  if (shorter === "" || shorter === "-") return { ...state, typed: "0" };
  return { ...state, typed: shorter };
}

export function press(state: CalcState, key: CalcKey): CalcState {
  switch (key.kind) {
    case "digit":
      return /^[0-9]$/.test(key.digit) ? typeDigit(state, key.digit) : state;
    case "decimal":
      return typeDecimal(state);
    case "operator":
      return pressOperator(state, key.op);
    case "equals":
      return pressEquals(state);
    case "percent":
      return pressPercent(state);
    case "negate":
      return pressNegate(state);
    case "clear":
      return pressClear(state);
    case "backspace":
      return pressBackspace(state);
    case "number":
      if (!Number.isFinite(key.value)) return state;
      return show(state.error ? INITIAL : state, key.value, { hasOperand: true, awaiting: null });
  }
}

/** "C" while there is a number to clear, "AC" when clearing would start over. */
export function clearLabel(state: CalcState): "AC" | "C" {
  if (state.error) return "AC";
  if (state.typed !== null) return "C";
  return state.hasOperand && state.value !== 0 ? "C" : "AC";
}

/** Presses in order: `run("2+3=")` in tests and for pasted text. */
export function pressAll(state: CalcState, keys: readonly CalcKey[]): CalcState {
  return keys.reduce(press, state);
}
