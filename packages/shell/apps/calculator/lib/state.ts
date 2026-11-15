/**
 * The Calculator's state and what changes it: the line (line.ts), the tape,
 * where ↑ and ↓ are on the tape, a word under the line for a moment, and the
 * key the keyboard just typed. One pure reducer, so the keyboard, the keypad,
 * the menus and the tape all change it the same way.
 */

import type { TextSelection } from "@mirinjs/metal";
import { fieldBase, fieldCaret, fromField } from "./field.ts";
import { charForKey, type KeyId, keyForChar } from "./keys.ts";
import {
  cutSelection,
  type Edited,
  EMPTY_LINE,
  equals,
  insertNumber,
  type Line,
  type Note,
  negate,
  paste,
  recall,
  relocalized,
  select,
  type TapeEntry,
  typeChar,
} from "./line.ts";
import type { NumberLocale } from "./locale.ts";
import { withEntry } from "./store.ts";

/** A word under the line for a moment: why a paste was refused, or that a copy happened. */
export type Notice = Note | "copied";

/** How many of the line's older texts are kept for the field to have typed on. */
const SENT_MOST = 8;

export interface CalcState {
  line: Line;
  tape: TapeEntry[];
  /** The tape entry ↑ and ↓ have put in the line, or null while the line is the person's own. */
  recalled: number | null;
  notice: Notice | null;
  /** The key to light on the keypad: the keyboard just typed it. */
  lit: KeyId | null;
  /**
   * The field's own text as it last reported it, while the line writes it
   * differently ("1250" for "1,250"): until the field takes the line's, it
   * may type on its own (field.ts).
   */
  held: string | null;
  /**
   * The line's texts the field may not have taken yet, or may hold still,
   * oldest first: each went out in a tree, the field takes the trees in
   * turn, and it types between them (a keypad key pressed and keys typed
   * 5 ms later; several of an agent's calls 2 ms apart).
   */
  sent: readonly string[];
  /** The caret the field is about to report in its own text (`held`): not the line's, so not taken. */
  late: TextSelection | null;
  /** Bumped when the field must take the line's text back though the line didn't change (an edit refused). */
  revision: number;
}

export function initialState(tape: readonly TapeEntry[] = []): CalcState {
  return { line: EMPTY_LINE, tape: [...tape], recalled: null, notice: null, lit: null, held: null, sent: [], late: null, revision: 0 };
}

export type CalcAction =
  /** The field's text after the person edited it there. */
  | { type: "field"; text: string; locale: NumberLocale }
  | { type: "select"; selection: TextSelection }
  /** A keypad key pressed. */
  | { type: "key"; id: KeyId; locale: NumberLocale }
  /** Return in the field. */
  | { type: "equals"; locale: NumberLocale }
  /** Esc in the field, Edit ▸ Clear. */
  | { type: "clear" }
  | { type: "paste"; text: string; locale: NumberLocale }
  | { type: "cut"; locale: NumberLocale }
  | { type: "select-all" }
  /** A result on the tape, clicked: into the line at the caret. */
  | { type: "use"; value: number; locale: NumberLocale }
  /** A sum on the tape back in the line (↑ ↓, or Edit Sum on a row: `index`). */
  | { type: "recall"; step: 1 | -1; locale: NumberLocale }
  | { type: "recall-entry"; index: number; locale: NumberLocale }
  | { type: "clear-tape" }
  | { type: "notice"; notice: Notice | null }
  /** The region changed: the line is written in the new locale's marks. */
  | { type: "relocale"; from: NumberLocale; to: NumberLocale }
  | { type: "unlit" };

/** The line edited: the tape position and the word under it are the person's no longer. */
function edited(state: CalcState, { line, note }: Edited, lit: KeyId | null = null): CalcState {
  if (line === state.line && !note) return lit ? { ...state, lit } : state;
  return { ...state, line, recalled: null, notice: note ?? null, lit };
}

function workedOut(state: CalcState, locale: NumberLocale): CalcState {
  const { line, entry } = equals(state.line, locale);
  return { ...state, line, tape: entry ? withEntry(state.tape, entry) : state.tape, recalled: null, notice: null, lit: "equals" };
}

/** The single character a field edit typed, for lighting its key. */
function typedChar(before: string, after: string): string | null {
  if (after.length !== before.length + 1) return null;
  let at = 0;
  while (at < before.length && before[at] === after[at]) at += 1;
  return after[at] ?? null;
}

/**
 * The field reported `raw` and the line took it as `next`: when the line
 * writes it differently the field takes the line's text back (a new revision
 * when the line itself didn't change, an edit refused), and until then its
 * own text and the caret it reports in it are not the line's.
 */
function fieldTook(state: CalcState, next: CalcState, raw: string): CalcState {
  // Typed on a text of the line's it had taken: the ones before that, it holds no longer.
  const base = fieldBase(state.line, raw, mayHold(state));
  const taken = base === null || base === state.held ? -1 : state.sent.lastIndexOf(base);
  const sent = sentWith(state.sent.slice(taken + 1), state.line.text);
  if (next.line.text === raw) return { ...next, held: null, sent, late: null };
  const caret = fieldCaret(state.line, raw, mayHold(state));
  const late = caret.start === next.line.selection.start && caret.end === next.line.selection.end ? null : caret;
  const revision = next.line.text === state.line.text ? state.revision + 1 : state.revision;
  return { ...next, held: raw, sent, late, revision };
}

/** `sent` and then `text`, once: the newest `SENT_MOST`. */
function sentWith(sent: readonly string[], text: string): readonly string[] {
  return [...sent.filter((other) => other !== text), text].slice(-SENT_MOST);
}

/** The texts the field may hold that are not the line's: the line's older ones, then its own, the likeliest last. */
function mayHold(state: CalcState): readonly string[] {
  return state.held === null ? state.sent : [...state.sent, state.held];
}

export function calculate(state: CalcState, action: CalcAction): CalcState {
  const next = step(state, action);
  if (action.type === "field" || action.type === "select" || next.line === state.line) return next;
  // The line changed another way (a keypad key, a paste): the field takes it, but until it has, it still
  // holds what it held and may type on that (an agent's click, then its keys 5 ms later: field.ts).
  return { ...next, sent: sentWith(state.sent, state.line.text), late: null };
}

function step(state: CalcState, action: CalcAction): CalcState {
  switch (action.type) {
    case "field": {
      const edit = fromField(state.line, action.text, action.locale, mayHold(state));
      const char = typedChar(fieldBase(state.line, action.text, mayHold(state)) ?? state.line.text, action.text);
      const lit = char === null ? null : keyForChar(char, action.locale);
      if (edit.kind === "equals") return fieldTook(state, workedOut(state, action.locale), action.text);
      if (edit.kind === "negate") return fieldTook(state, edited(state, { line: negate(state.line, action.locale) }, "negate"), action.text);
      return fieldTook(state, edited(state, edit.edited, lit), action.text);
    }
    case "select": {
      // The caret the field reported in its own text, before it took the line's: the line has its own.
      const late = state.late;
      if (late && late.start === action.selection.start && late.end === action.selection.end) return { ...state, late: null };
      // A caret in the line's own text: the field has taken it, and holds nothing else.
      return { ...state, late: null, held: null, sent: [], line: select(state.line, action.selection) };
    }
    case "key": {
      if (action.id === "equals") return { ...workedOut(state, action.locale), lit: null };
      if (action.id === "clear") return edited(state, { line: EMPTY_LINE });
      if (action.id === "negate") return edited(state, { line: negate(state.line, action.locale) });
      const char = charForKey(action.id, action.locale);
      return char === null ? state : edited(state, { line: typeChar(state.line, char, action.locale) });
    }
    case "equals":
      return workedOut(state, action.locale);
    case "clear":
      return edited(state, { line: EMPTY_LINE }, "clear");
    case "paste":
      return edited(state, paste(state.line, action.text, action.locale));
    case "cut":
      return edited(state, { line: cutSelection(state.line, action.locale) });
    case "select-all":
      return { ...state, line: select(state.line, { start: 0, end: state.line.text.length }) };
    case "use":
      return edited(state, { line: insertNumber(state.line, action.value, action.locale) });
    case "recall": {
      if (state.tape.length === 0) return state;
      const from = state.recalled ?? state.tape.length;
      const index = from - action.step;
      if (index >= state.tape.length) return { ...state, line: EMPTY_LINE, recalled: null, notice: null };
      const at = Math.max(0, index);
      const entry = state.tape[at];
      return entry ? { ...state, line: recall(entry, action.locale), recalled: at, notice: null } : state;
    }
    case "recall-entry": {
      const entry = state.tape[action.index];
      return entry ? { ...state, line: recall(entry, action.locale), recalled: action.index, notice: null } : state;
    }
    case "clear-tape":
      return { ...state, tape: [], recalled: null };
    case "notice":
      return { ...state, notice: action.notice };
    case "relocale":
      return { ...state, line: relocalized(state.line, action.from, action.to) };
    case "unlit":
      return state.lit === null ? state : { ...state, lit: null };
  }
}
