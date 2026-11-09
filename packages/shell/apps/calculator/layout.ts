/**
 * The Calculator's measures (LA-3): the keypad's grid at its smallest, which
 * sets the window's minimum; the tape beside it, which widens the window by
 * its own width and the minimum with it; and square keys that grow with the
 * window (a zoomed Calculator is a bigger keypad, not stretched keys), the
 * spare height going to the display. Pure.
 */

import type { Size } from "../kit/index.ts";

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

/** The smallest window with the tape shown or not: the tape sits beside the keypad at its smallest, never over it. */
export function leastSize(showsTape: boolean): Size {
  return { width: MIN_SIZE.width + (showsTape ? TAPE_WIDTH : 0), height: MIN_SIZE.height };
}

/** The size to open at: the one last seen, never under the least (with the tape's room when it shows). */
export function openingSize(remembered: Size | null, showsTape: boolean): Size {
  const least = leastSize(showsTape);
  if (!remembered) return least;
  return { width: Math.max(least.width, remembered.width), height: Math.max(least.height, remembered.height) };
}

/** The window after the tape shows or hides: wider or narrower by the tape, never under the least. */
export function sizeWithTape(size: Size, showsTape: boolean): Size {
  const least = leastSize(showsTape);
  const width = showsTape ? size.width + TAPE_WIDTH : size.width - TAPE_WIDTH;
  return { width: Math.max(least.width, width), height: Math.max(least.height, size.height) };
}

/** A key's side for a keypad column `width` wide in a window `height` tall: the smaller of a key's width and height. */
export function keySide(width: number, height: number): number {
  const across = (width - PAD * 2 - GAP * (COLUMNS - 1)) / COLUMNS;
  const down = (height - DISPLAY - PAD - GAP * (ROWS - 1)) / ROWS;
  return Math.max(KEY, Math.floor(Math.min(across, down)));
}

/**
 * The keypad in a column `width` wide and a window `height` tall: square
 * keys of `side`, the grid centred across the column (`inset` each side, the
 * display's too, so the line, its result and the keys share one right edge),
 * and the display taking the height the keys leave.
 */
export interface KeypadLayout {
  side: number;
  inset: number;
  /** The grid's own height, with the margin under it. */
  height: number;
}

export function keypadLayout(width: number, height: number): KeypadLayout {
  const side = keySide(width, height);
  const across = side * COLUMNS + GAP * (COLUMNS - 1);
  return {
    side,
    inset: Math.max(PAD, Math.floor((width - across) / 2)),
    height: side * ROWS + GAP * (ROWS - 1) + PAD,
  };
}

/** The keys' type for a key `side` px: 24 for a digit at the smallest, growing with the key, 44 at most. */
export function keyFontSize(side: number): number {
  return Math.min(44, Math.round(24 * (side / KEY)));
}

/** The expression line's type: as large as fits, from 40 down to 22 (past that the line scrolls to the caret). */
export const LINE_LARGEST = 40;
export const LINE_SMALLEST = 22;
