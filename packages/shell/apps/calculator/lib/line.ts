/**
 * The expression line: its text, its caret, and the result standing in it
 * after = (the carry). Every way in edits it the same way: a key on the
 * keyboard, a key on the keypad, a paste, a result clicked on the tape. Pure.
 *
 * - The line keeps itself tidy as it is edited: numbers grouped the locale's
 *   way, one space around each operator ("1,250 × 12 + 340"); the caret stays
 *   after the same digit or operator it was after.
 * - Two operators in a row: the second takes the first's place ("−" after an
 *   operator is a sign instead: "3 × −2").
 * - = works the line out: the sum goes to the tape and its result stands in
 *   the line, selected. A digit then starts a new sum; an operator goes on
 *   from the result. = again repeats the last step (2 + 3 = 5, = 8).
 * - A number holds 15 digits: a digit typed into one that is full is refused,
 *   wherever the caret is, and so is any edit that would make a longer one.
 * - A paste is one number, or a sum of numbers, operators and brackets; text
 *   with anything else in it (letters, a date) is refused, never typed in key
 *   by key, and numbers whose marks the locale would not write are refused
 *   rather than guessed at ("1,5" in English).
 */

import type { TextSelection } from "@mirinjs/metal";
import { evaluate, hasOperation, type Outcome, repeatOf, settled } from "./evaluate.ts";
import { isQuiet, operatorFor, overflows, render, type Token, tokenize } from "./expression.ts";
import { formatResult, numberTokens, parsePasted, readNumber } from "./format.ts";
import { EN_US, type NumberLocale, numberMarks } from "./locale.ts";

/** A result standing in the line after =, kept exact (the text shows 15 digits). */
export interface Carry {
  text: string;
  value: number;
  /** The last step of the sum it came from, for = again ("+ 3"). */
  repeat: Token[] | null;
}

export interface Line {
  text: string;
  selection: TextSelection;
  carry: Carry | null;
}

/** One finished sum on the tape: the expression in plain marks ("1250 × 12 + 340"), and its result. */
export interface TapeEntry {
  expression: string;
  value: number;
}

export const EMPTY_LINE: Line = { text: "", selection: { start: 0, end: 0 }, carry: null };

/** Why the line did not take an edit, for a word under it. */
export type Note = "refused-paste";

export interface Edited {
  line: Line;
  note?: Note;
}

const caretAt = (at: number): TextSelection => ({ start: at, end: at });
const isAllSelected = (line: Line): boolean => line.selection.start === 0 && line.selection.end === line.text.length && line.text.length > 0;
/** The carry is the whole line, selected: what comes next either goes on from it or replaces it. */
const isCarryShown = (line: Line): boolean => line.carry !== null && line.text === line.carry.text && isAllSelected(line);

/**
 * `raw` written the tidy way, with the caret after the same meaningful
 * character it was after in `raw` (spaces and grouping marks don't count).
 */
export function tidy(raw: string, caret: number, locale: NumberLocale): { text: string; caret: number } {
  let meaningful = 0;
  for (let at = 0; at < Math.min(caret, raw.length); at += 1) if (!isQuiet(raw[at] as string, locale)) meaningful += 1;
  const text = render(tokenize(raw, locale), locale);
  let at = 0;
  for (let seen = 0; at < text.length && seen < meaningful; at += 1) if (!isQuiet(text[at] as string, locale)) seen += 1;
  return { text, caret: at };
}

/**
 * `raw` tidied into a line with the caret at `caret`; the carry stays only
 * while the text is still the result. An edit that would give a number a
 * sixteenth digit is refused: the line stays as it was.
 */
export function settle(line: Line, raw: string, caret: number, locale: NumberLocale): Line {
  if (overflows(raw, locale)) return line;
  const tidied = tidy(raw, caret, locale);
  const carry = line.carry && tidied.text.startsWith(line.carry.text) ? line.carry : null;
  return { text: tidied.text, selection: caretAt(tidied.caret), carry };
}

/** What a typed character puts in the line: itself, its operator ("*" is ×), the locale's decimal mark, or nothing. */
function typedText(char: string, locale: NumberLocale): string {
  if (/^[0-9]$/.test(char) || char === "%" || char === "(" || char === ")") return char;
  if (numberMarks(locale).decimals.has(char)) return locale.decimal;
  return operatorFor(char) ?? "";
}

/** Pasted text as what it puts in the line, or null when it is refused (see the header). */
export function pastedText(text: string, locale: NumberLocale): string | null {
  const one = parsePasted(text, locale);
  if (one !== null) return formatResult(one, locale);
  const { decimals, groups } = numberMarks(locale);
  const trimmed = text.trim();
  if (trimmed === "") return null;
  // A sum: numbers (well formed in the locale), operators, %, brackets, spaces. Nothing else, and no "x" for ×.
  const parts = trimmed.match(/[0-9][0-9.,٫'’\u00a0\u202f\u2009 ]*[0-9]|[0-9]|[.,٫][0-9]+|[^\s]/gu) ?? [];
  let written = "";
  for (const part of parts) {
    if (/[0-9]/.test(part)) {
      const value = readNumber(part.trim(), locale);
      if (value === null) return null;
      written += ` ${formatResult(value, locale)} `;
    } else if (part !== "x" && part !== "X" && (operatorFor(part) || part === "%" || part === "(" || part === ")")) {
      written += ` ${part} `;
    } else if (!(decimals.has(part) || groups.has(part))) {
      return null;
    }
  }
  return written;
}

const OPERATORS = new Set(["+", "−", "×", "÷"]);

/** Put `inserted` (already what the line takes) in place of the selection. */
function place(line: Line, inserted: string, locale: NumberLocale): Line {
  // After =, an operator (or %) goes on from the result, anything else replaces it.
  const goesOn = isCarryShown(line) && (OPERATORS.has(inserted.trim()[0] ?? "") || inserted.startsWith("%"));
  const start = goesOn ? line.text.length : line.selection.start;
  const end = goesOn ? line.text.length : line.selection.end;
  let before = line.text.slice(0, start);
  const after = line.text.slice(end);
  const op = inserted.trim();
  if (op === "+" || op === "×" || op === "÷" || op === "−") {
    // Two operators in a row: the new one takes the old one's place, except a sign after one (3 × −2).
    const trimmed = before.replace(/\s+$/u, "");
    const last = trimmed.at(-1) ?? "";
    if (OPERATORS.has(last) && (op !== "−" || last === "−")) before = trimmed.slice(0, -1);
    else if (trimmed === "" && op !== "−" && !line.carry) return line;
  }
  const kept = goesOn ? line : { ...line, carry: start === 0 && end === line.text.length ? null : line.carry };
  return settle(kept, before + inserted + after, before.length + inserted.length, locale);
}

/** A character typed, or a keypad key: digits, marks, operators, %, brackets. Anything else changes nothing. */
export function typeChar(line: Line, char: string, locale: NumberLocale): Line {
  const inserted = typedText(char, locale);
  return inserted === "" ? line : place(line, inserted, locale);
}

/** Text pasted over the selection (❖V, Edit ▸ Paste), or refused with a note. */
export function paste(line: Line, text: string, locale: NumberLocale): Edited {
  const inserted = pastedText(text, locale);
  if (inserted === null) return { line, note: "refused-paste" };
  return { line: place({ ...line, carry: isCarryShown(line) ? null : line.carry }, inserted, locale) };
}

/** A number put in the line at the caret, as a paste of it is: a result clicked on the tape. */
export function insertNumber(line: Line, value: number, locale: NumberLocale): Line {
  return place({ ...line, carry: isCarryShown(line) ? null : line.carry }, formatResult(value, locale), locale);
}

/** The span of the number at or before the caret (the last one in the line when the caret is in none), or null. */
function numberSpan(text: string, caret: number, locale: NumberLocale): { start: number; end: number } | null {
  const { decimals, groups } = numberMarks(locale);
  const inNumber = (char: string | undefined): boolean => char !== undefined && (/[0-9e]/.test(char) || decimals.has(char) || groups.has(char));
  let at = caret;
  if (!inNumber(text[at - 1]) && !inNumber(text[at])) {
    at = text.length;
    while (at > 0 && !/[0-9]/.test(text[at - 1] as string)) at -= 1;
    if (at === 0) return null;
  }
  let start = at;
  while (start > 0 && inNumber(text[start - 1])) start -= 1;
  let end = at;
  while (end < text.length && inNumber(text[end])) end += 1;
  return start === end ? null : { start, end };
}

/** ± (or "n"): the number at the caret changes sign; with none, a minus starts one. */
export function negate(line: Line, locale: NumberLocale): Line {
  if (isCarryShown(line) && line.carry) {
    const value = -line.carry.value;
    const text = formatResult(value, locale);
    return { text, selection: { start: 0, end: text.length }, carry: { ...line.carry, text, value } };
  }
  const span = numberSpan(line.text, line.selection.end, locale);
  if (!span) return place(line, "−", locale);
  const signed = line.text[span.start - 1] === "−" && /^(?:|.*[\s(+−×÷])$/u.test(line.text.slice(0, span.start - 1));
  const raw = signed ? line.text.slice(0, span.start - 1) + line.text.slice(span.start) : `${line.text.slice(0, span.start)}−${line.text.slice(span.start)}`;
  const caret = Math.max(0, line.selection.end + (line.selection.end >= span.start ? (signed ? -1 : 1) : 0));
  return settle({ ...line, carry: null }, raw, caret, locale);
}

/** The line's tokens, its leading result exact when the result still stands at its start. */
function tokensOf(line: Line, locale: NumberLocale): Token[] {
  const tokens = tokenize(line.text, locale);
  const carry = line.carry;
  if (!carry || !line.text.startsWith(carry.text)) return tokens;
  const exact = numberTokens(carry.value);
  const shown = tokenize(carry.text, locale);
  // Swap the shown digits for the exact value: same tokens, so the number wasn't typed on.
  if (shown.length !== exact.length || render(tokens.slice(0, shown.length), locale) !== render(shown, locale)) return tokens;
  const following = tokens[shown.length];
  if (following?.kind === "number") return tokens;
  return [...exactTokens(carry.value), ...tokens.slice(shown.length)];
}

/** A value as tokens a sum can hold exactly: a sign and a number token of the full double. */
function exactTokens(value: number): Token[] {
  const digits = String(Math.abs(value));
  const match = /^(\d+)(?:\.(\d+))?(e[-+]?\d+)?$/.exec(digits);
  const number: Token = { kind: "number", whole: match?.[1] ?? "0", fraction: match?.[2] ?? null, exponent: (match?.[3] ?? "").replace("+", "") };
  return value < 0 ? [{ kind: "op", op: "−" }, number] : [number];
}

/** What the line works out to so far, shown under it; none while it is a lone number. */
export function liveResult(line: Line, locale: NumberLocale): Outcome {
  const tokens = tokensOf(line, locale);
  if (!hasOperation(tokens)) return { kind: "none" };
  return evaluate(tokens);
}

/** An expression in plain marks, for the tape's file: "1250 × 12 + 340". */
export function plainExpression(tokens: readonly Token[]): string {
  return render(tokens, EN_US, false);
}

/** A stored expression in the locale's marks: "1.250 × 12 + 340" in German. */
export function shownExpression(expression: string, locale: NumberLocale): string {
  return render(tokenize(expression, EN_US), locale);
}

/**
 * = (Enter, the = key): the line worked out. A sum goes to the tape and its
 * result stands in the line, selected; a lone number is only selected; = on
 * a result just worked out repeats the last step. A line that can't be worked
 * out stays as it is (the line under it says why).
 */
export function equals(line: Line, locale: NumberLocale): { line: Line; entry?: TapeEntry } {
  const carry = isCarryShown(line) ? line.carry : null;
  const repeat = carry?.repeat ?? null;
  const tokens = carry && repeat ? [...exactTokens(carry.value), ...repeat] : settled(tokensOf(line, locale));
  const outcome = evaluate(tokens);
  if (outcome.kind !== "value") return { line };
  const text = formatResult(outcome.value, locale);
  const all = { start: 0, end: text.length };
  if (!hasOperation(tokens)) return { line: { text, selection: all, carry: { text, value: outcome.exact, repeat: null } } };
  // The tape shows the sum as it was seen: the result's shown digits, not the double behind them.
  const shown = carry && repeat ? [...numberTokens(carry.value), ...repeat] : settled(tokenize(line.text, locale));
  return {
    line: { text, selection: all, carry: { text, value: outcome.exact, repeat: repeatOf(tokens) } },
    entry: { expression: plainExpression(shown), value: outcome.value },
  };
}

/** A sum from the tape back in the line, to change and work out again (↑ and ↓). */
export function recall(entry: TapeEntry, locale: NumberLocale): Line {
  const text = shownExpression(entry.expression, locale);
  return { text, selection: caretAt(text.length), carry: null };
}

/** The selected text, for Cut and Copy from the menu. */
export function selectedText(line: Line): string {
  return line.text.slice(line.selection.start, line.selection.end);
}

/** Cut from the menu: the selection goes, as ⌫ would take it. */
export function cutSelection(line: Line, locale: NumberLocale): Line {
  const { start, end } = line.selection;
  if (start === end) return line;
  return settle({ ...line, carry: null }, line.text.slice(0, start) + line.text.slice(end), start, locale);
}

/** The field's caret and selection, kept within the text. */
export function select(line: Line, selection: TextSelection): Line {
  const clamp = (at: number): number => Math.max(0, Math.min(line.text.length, at));
  const next = { start: clamp(Math.min(selection.start, selection.end)), end: clamp(Math.max(selection.start, selection.end)) };
  return next.start === line.selection.start && next.end === line.selection.end ? line : { ...line, selection: next };
}

/**
 * The line in another locale's marks, when the region changes under it:
 * "1.250 × 12" in German is "1,250 × 12" in English, the caret after the same
 * digit, a result standing in it written anew.
 */
export function relocalized(line: Line, from: NumberLocale, to: NumberLocale): Line {
  if (line.text === "") return line;
  const text = render(tokenize(line.text, from), to);
  const spot = (at: number): number => {
    let meaningful = 0;
    for (let index = 0; index < Math.min(at, line.text.length); index += 1) if (!isQuiet(line.text[index] as string, from)) meaningful += 1;
    let moved = 0;
    for (let seen = 0; moved < text.length && seen < meaningful; moved += 1) if (!isQuiet(text[moved] as string, to)) seen += 1;
    return moved;
  };
  const wholeCarry = line.carry !== null && line.text === line.carry.text;
  const carry = line.carry && { ...line.carry, text: wholeCarry ? text : formatResult(line.carry.value, to) };
  const all = line.selection.start === 0 && line.selection.end === line.text.length;
  const selection = all ? { start: 0, end: text.length } : { start: spot(line.selection.start), end: spot(line.selection.end) };
  return { text, selection, carry: carry && (wholeCarry || text.startsWith(carry.text) ? carry : null) };
}
