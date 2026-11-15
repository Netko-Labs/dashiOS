/**
 * The expression line as a text field: what the field reports, read the
 * line's way. The field edits its own copy of the text and says so (its text,
 * then its caret); the line takes the edit and writes itself tidy, and the
 * field takes that text back. Between the two the field may have reported a
 * caret in its own, untidy text, and typed on it again before it took the
 * line's (fast typing): neither is the line's. The same holds when the line
 * changed another way (a keypad key, a paste) and the field typed before it
 * took that: an agent's click on 7 and "*6=" typed 5 ms later, or several
 * calls 2 ms apart, the field taking a tree between two of its keys
 * (decisions.md D124). Pure.
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

/** What of `text` counts: its digits and operators, without spaces and grouping marks. */
const meaningful = (text: string, locale: NumberLocale): string => [...text].filter((char) => !isQuiet(char, locale)).join("");

/**
 * Where offset `at` in `from` (the field's own text) is in `to` (the line's):
 * after the same digit or operator (spaces and grouping marks don't count).
 * What the line has that the field never held (a keypad key pressed while the
 * field was still behind, written at its caret) is before that spot: the
 * field's caret would have moved past it.
 */
function sameSpot(from: string, at: number, to: string, locale: NumberLocale): number {
  const before = meaningful(from.slice(0, at), locale).length;
  const change = spliceOf(meaningful(from, locale), meaningful(to, locale));
  const untouched = before < change.start || (before === change.start && change.end > change.start);
  const count = untouched ? before : change.start + change.inserted.length + Math.max(0, before - change.end);
  let spot = 0;
  for (let seen = 0; spot < to.length && seen < count; spot += 1) if (!isQuiet(to[spot] as string, locale)) seen += 1;
  return spot;
}

/**
 * The field's edit and the text it made it on. `held` are the texts the
 * field may hold that are not the line's, the likeliest last: the line's
 * as it was before it changed (the field takes each tree in turn, and types
 * between them), then the field's own as it last reported it. The edit is
 * the smallest one from any of them, the later first among equals, and the
 * line's own text before them all.
 */
function editOf(line: Line, raw: string, held: readonly string[]): { base: string | null; splice: Splice } {
  const direct = spliceOf(line.text, raw);
  let best: { base: string | null; splice: Splice } = { base: null, splice: direct };
  for (let index = held.length - 1; index >= 0; index -= 1) {
    const base = held[index] as string;
    if (base === line.text) continue;
    const own = spliceOf(base, raw);
    // The line's very text reported as an edit is one typed on the field's own: it ended up spelling the line's.
    const smaller = sizeOf(best.splice) === 0 || sizeOf(own) < sizeOf(best.splice);
    if (sizeOf(own) > 0 && smaller) best = { base, splice: own };
  }
  return best;
}

/** The text the field made its edit on, when that is not the line's: one of `held`. */
export function fieldBase(line: Line, raw: string, held: readonly string[]): string | null {
  return editOf(line, raw, held).base;
}

/** The field's edit as a splice of the line's text: one made on its own text lands at the same digits in the line. */
function spliceInLine(line: Line, raw: string, held: readonly string[], locale: NumberLocale): Splice {
  const { base, splice } = editOf(line, raw, held);
  if (base === null) return splice;
  return { start: sameSpot(base, splice.start, line.text, locale), end: sameSpot(base, splice.end, line.text, locale), inserted: splice.inserted };
}

/** The field's caret in `raw` just after its edit (after what it typed), as it reports it next. */
export function fieldCaret(line: Line, raw: string, held: readonly string[]): TextSelection {
  const { splice } = editOf(line, raw, held);
  const at = splice.start + splice.inserted.length;
  return { start: at, end: at };
}

/**
 * The field's text after the person edited it there (typing, ⌫, a paste,
 * Cut): what changed, against the line as it was, done the line's way.
 * Typing "=" works it out and "n" negates; they never land in the text.
 */
export function fromField(line: Line, raw: string, locale: NumberLocale, held: readonly string[] = []): FieldEdit {
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
