/**
 * The expression line as a text field: what the field reports, read the
 * line's way. The field edits its own copy of the text and says so (its text,
 * then its caret); the line takes the edit and writes itself tidy, and the
 * field takes that text back. Between the two the field may have reported a
 * caret in its own, untidy text, and typed on it again before it took the
 * line's (fast typing): neither is the line's. Pure.
 */

import type { TextSelection } from "@mirinjs/metal";
import { isQuiet } from "./expression.ts";
import { type Edited, type Line, paste, settle, typeChar } from "./line.ts";
import type { NumberLocale } from "./locale.ts";

export type FieldEdit = { kind: "line"; edited: Edited } | { kind: "equals" } | { kind: "negate" };

/** One edit between two texts: `old.slice(start, end)` became `inserted`. */
interface Splice {
  start: number;
  end: number;
  inserted: string;
}

function spliceOf(old: string, raw: string): Splice {
  let prefix = 0;
  while (prefix < old.length && prefix < raw.length && old[prefix] === raw[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < old.length - prefix && suffix < raw.length - prefix && old[old.length - 1 - suffix] === raw[raw.length - 1 - suffix]) suffix += 1;
  return { start: prefix, end: old.length - suffix, inserted: raw.slice(prefix, raw.length - suffix) };
}

const sizeOf = (splice: Splice): number => splice.end - splice.start + splice.inserted.length;

/** Where offset `at` in `from` is in `to`: after the same digit or operator (spaces and grouping marks don't count). */
function sameSpot(from: string, at: number, to: string, locale: NumberLocale): number {
  let meaningful = 0;
  for (let index = 0; index < at; index += 1) if (!isQuiet(from[index] as string, locale)) meaningful += 1;
  let spot = 0;
  for (let seen = 0; spot < to.length && seen < meaningful; spot += 1) if (!isQuiet(to[spot] as string, locale)) seen += 1;
  return spot;
}

/**
 * The field's edit and the text it made it on. `held` is the field's own
 * text as it last reported it: when the line wrote that differently and the
 * field typed on its own before taking the line's, the edit is the smaller
 * one from `held`.
 */
function editOf(line: Line, raw: string, held: string | null): { onOwn: boolean; splice: Splice } {
  const direct = spliceOf(line.text, raw);
  if (held === null || held === line.text) return { onOwn: false, splice: direct };
  const own = spliceOf(held, raw);
  return sizeOf(own) > 0 && sizeOf(own) < sizeOf(direct) ? { onOwn: true, splice: own } : { onOwn: false, splice: direct };
}

/** The field's edit as a splice of the line's text: one made on its own text lands at the same digits in the line. */
function spliceInLine(line: Line, raw: string, held: string | null, locale: NumberLocale): Splice {
  const { onOwn, splice } = editOf(line, raw, held);
  if (!onOwn || held === null) return splice;
  return { start: sameSpot(held, splice.start, line.text, locale), end: sameSpot(held, splice.end, line.text, locale), inserted: splice.inserted };
}

/** The field's caret in `raw` just after its edit (after what it typed), as it reports it next. */
export function fieldCaret(line: Line, raw: string, held: string | null): TextSelection {
  const { splice } = editOf(line, raw, held);
  const at = splice.start + splice.inserted.length;
  return { start: at, end: at };
}

/**
 * The field's text after the person edited it there (typing, ⌫, a paste,
 * Cut): what changed, against the line as it was, done the line's way.
 * Typing "=" works it out and "n" negates; they never land in the text.
 */
export function fromField(line: Line, raw: string, locale: NumberLocale, held: string | null = null): FieldEdit {
  const old = line.text;
  const { start: from, end, inserted } = spliceInLine(line, raw, held, locale);
  const removed = old.slice(from, end);
  const replacing: Line = { ...line, selection: { start: from, end } };
  if (inserted === "") {
    // A deletion of only spaces or grouping marks would come straight back: take the digit or operator before them too.
    let start = from;
    if (removed !== "" && [...removed].every((char) => isQuiet(char, locale))) {
      while (start > 0 && isQuiet(old[start - 1] as string, locale)) start -= 1;
      start = Math.max(0, start - 1);
    }
    return {
      kind: "line",
      edited: { line: settle({ ...line, carry: start === 0 && end === old.length ? null : line.carry }, old.slice(0, start) + old.slice(end), start, locale) },
    };
  }
  if ([...inserted].length > 1) return { kind: "line", edited: paste(replacing, inserted, locale) };
  if (inserted === "=") return { kind: "equals" };
  if (inserted === "n" || inserted === "N") return { kind: "negate" };
  return { kind: "line", edited: { line: typeChar(replacing, inserted, locale) } };
}
