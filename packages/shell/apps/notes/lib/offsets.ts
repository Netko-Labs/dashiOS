/**
 * Between a note's Markdown and what its field shows (project.ts): the
 * pieces of one laid against the other, and offsets carried across. A piece
 * is kept (the same letters on both sides) or replaced (`## ` by nothing, `-`
 * by `•`, a table's row by a space). A place in the shown text goes to the
 * Markdown before the letter after it (past a hidden `**` that opens) when it
 * starts something, and after the letter before it (short of a `**` that
 * closes) when it ends something, so a selection of drawn words is those
 * words' source. Pure.
 */

import type { Selection } from "./format.ts";

/** Source `src..srcEnd` is shown as `disp..dispEnd`; `kept` when both are the same letters. */
export interface Piece {
  src: number;
  srcEnd: number;
  disp: number;
  dispEnd: number;
  kept: boolean;
}

/** The first piece whose `key` end is past `at` (pieces are in order on both sides). */
function firstPast(pieces: readonly Piece[], at: number, key: "srcEnd" | "dispEnd"): Piece | null {
  let low = 0;
  let high = pieces.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((pieces[middle]?.[key] ?? 0) > at) high = middle;
    else low = middle + 1;
  }
  return pieces[low] ?? null;
}

const linear = (piece: Piece): boolean => piece.kept || piece.srcEnd - piece.src === piece.dispEnd - piece.disp;

/** Where source offset `src` is in the shown text. */
export function toDisplay(pieces: readonly Piece[], src: number): number {
  const piece = firstPast(pieces, src, "srcEnd");
  if (!piece) return pieces.at(-1)?.dispEnd ?? 0;
  if (linear(piece)) return piece.disp + (src - piece.src);
  return src <= piece.src ? piece.disp : piece.dispEnd;
}

/** The source of a place in the shown text that starts something: before the source of the letter at `at`. */
export function sourceStart(pieces: readonly Piece[], at: number): number {
  const piece = firstPast(pieces, at, "dispEnd");
  if (!piece) return pieces.at(-1)?.srcEnd ?? 0;
  return linear(piece) ? piece.src + (at - piece.disp) : piece.src;
}

/** The source of a place in the shown text that ends something: after the source of the letter before `at`. */
export function sourceEnd(pieces: readonly Piece[], at: number): number {
  if (at <= 0) return 0;
  const piece = firstPast(pieces, at - 1, "dispEnd");
  if (!piece) return pieces.at(-1)?.srcEnd ?? 0;
  return linear(piece) ? piece.src + (at - piece.disp) : piece.srcEnd;
}

/** A source selection as the field shows it. */
export function displaySelection(pieces: readonly Piece[], selection: Selection): Selection {
  return { start: toDisplay(pieces, selection.start), end: toDisplay(pieces, selection.end) };
}

/** A selection in the shown text as source: a caret starts where the letter after it begins; a range covers its letters' source. */
export function sourceSelection(pieces: readonly Piece[], selection: Selection): Selection {
  const low = Math.min(selection.start, selection.end);
  const high = Math.max(selection.start, selection.end);
  if (low === high) {
    const at = sourceStart(pieces, low);
    return { start: at, end: at };
  }
  return { start: sourceStart(pieces, low), end: Math.max(sourceStart(pieces, low), sourceEnd(pieces, high)) };
}

/**
 * The note's Markdown once the field's text went from `shown` to `next`: the
 * one stretch that changed (found from both ends, its start no later than the
 * field's selection, so typing "a" after "a" lands where it was typed) is
 * replaced in the source by what was typed.
 */
export function sourceEdit(body: string, pieces: readonly Piece[], shown: string, next: string, selection: Selection): string {
  const limit = Math.min(shown.length, next.length, Math.min(selection.start, selection.end));
  let prefix = 0;
  while (prefix < limit && shown[prefix] === next[prefix]) prefix++;
  let suffix = 0;
  const room = Math.min(shown.length, next.length) - prefix;
  while (suffix < room && shown[shown.length - 1 - suffix] === next[next.length - 1 - suffix]) suffix++;
  const end = shown.length - suffix;
  const typed = next.slice(prefix, next.length - suffix);
  const from = sourceStart(pieces, prefix);
  const to = end === prefix ? from : Math.max(from, sourceEnd(pieces, end));
  return body.slice(0, from) + typed + body.slice(to);
}
