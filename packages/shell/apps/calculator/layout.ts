/**
 * The Calculator's measures: the keypad's grid, the window around it, and
 * where the display's number sits so it lines up with that grid. Pure.
 */

/** A key's side. */
export const KEY = 54;
/** Between keys, across and down. */
export const GAP = 10;
/** Around the keypad. */
export const PAD = 14;
/** The display's band, the window controls' strip included. */
export const DISPLAY = 96;
export const COLUMNS = 4;
export const ROWS = 5;

/** The window's size: four keys across, a display and five rows down. */
export const CALCULATOR_SIZE = {
  width: PAD * 2 + KEY * COLUMNS + GAP * (COLUMNS - 1),
  height: DISPLAY + KEY * ROWS + GAP * (ROWS - 1) + PAD,
} as const;

/** The width the display's number may take. */
export const DISPLAY_WIDTH = CALCULATOR_SIZE.width - PAD * 2;

/**
 * The display's right and bottom padding for a number drawn at `fontSize`,
 * so that its digits end where the keypad's right edge is, and their foot
 * sits one key gap above the top row. A digit's ink stops short of its box:
 * about 0.075 em on the right and 0.02 em at the foot (docs/roast/calculator.md
 * measured the "0" at 52 px: 4 px inside its box's right edge, 1 px above its
 * bottom).
 */
export function displayInsets(fontSize: number): { right: number; bottom: number } {
  return { right: PAD - Math.round(fontSize * 0.075), bottom: GAP - Math.round(fontSize * 0.02) };
}
