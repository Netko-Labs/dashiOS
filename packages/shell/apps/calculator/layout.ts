/**
 * The Calculator's measures (LA-3): the keypad's grid at its smallest, which
 * sets the window's minimum; the tape beside it, which widens the window by
 * its own width; and sizes that grow with the keys when the window does (a
 * zoomed Calculator is a bigger keypad, not a small one in an empty field).
 * Pure.
 */

import type { Size } from "../kit/index.ts";
import { textEms } from "./format.ts";

/** A key's side at the smallest. */
export const KEY = 54;
/** Between keys, across and down. */
export const GAP = 10;
/** Around the keypad. */
export const PAD = 14;
/** The display's band: the window controls' strip, the expression line, and the result under it. */
export const DISPLAY = 116;
export const COLUMNS = 4;
export const ROWS = 5;
/** The tape, beside the keypad. */
export const TAPE_WIDTH = 224;

/** The smallest window: four keys across, the display and five rows down. */
export const MIN_SIZE: Size = {
  width: PAD * 2 + KEY * COLUMNS + GAP * (COLUMNS - 1),
  height: DISPLAY + KEY * ROWS + GAP * (ROWS - 1) + PAD,
};

/** The size to open at: the one last seen, never under the minimum (with the tape's room when it shows). */
export function openingSize(remembered: Size | null, showsTape: boolean): Size {
  const least = { width: MIN_SIZE.width + (showsTape ? TAPE_WIDTH : 0), height: MIN_SIZE.height };
  if (!remembered) return least;
  return { width: Math.max(least.width, remembered.width), height: Math.max(least.height, remembered.height) };
}

/** The window after the tape shows or hides: wider or narrower by the tape, never under the minimum. */
export function sizeWithTape(size: Size, showsTape: boolean): Size {
  const width = showsTape ? size.width + TAPE_WIDTH : Math.max(MIN_SIZE.width, size.width - TAPE_WIDTH);
  return { width, height: size.height };
}

/** A key's side for a keypad column `width` wide in a window `height` tall: the smaller of a key's width and height. */
export function keySide(width: number, height: number): number {
  const across = (width - PAD * 2 - GAP * (COLUMNS - 1)) / COLUMNS;
  const down = (height - DISPLAY - PAD - GAP * (ROWS - 1)) / ROWS;
  return Math.max(KEY, Math.floor(Math.min(across, down)));
}

/** The keys' type for a key `side` px: 24 for a digit at the smallest, growing with the key, 44 at most. */
export function keyFontSize(side: number): number {
  return Math.min(44, Math.round(24 * (side / KEY)));
}

/** The expression line's type: as large as fits, from 40 down to 22 (past that the line scrolls). */
export const LINE_LARGEST = 40;
export const LINE_SMALLEST = 22;

/**
 * The field's width for `text` at `fontSize` in a display `room` px wide:
 * the text's own width (with room for the caret), so the line ends at the
 * keypad's right edge; all the room once the text needs it, when it scrolls.
 */
export function fieldWidth(text: string, fontSize: number, room: number): number {
  const wanted = Math.ceil((textEms(text || "0") + 0.5) * fontSize);
  return Math.max(fontSize, Math.min(room, wanted));
}
