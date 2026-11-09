/**
 * How Software's one toolbar row fits a narrow window (VS-1: one chrome row,
 * nothing spills out of it). Under `COMPACT_BELOW` points for the page (the
 * window less its sidebar), the row gives way in a set order: the window's
 * name goes (the sidebar says where you are), Check for Updates and
 * Catalogs… become their glyphs with a tooltip, the activity chip drops the
 * app's name but keeps its progress, and the search field shrinks to its
 * least width last of all.
 */

/** Room for the page, in points, under which the toolbar is compact. */
export const COMPACT_BELOW = 600;

/** The search field's width, and the least it shrinks to when the row is short of room. */
export const SEARCH_WIDTH = 210;
export const SEARCH_MIN_WIDTH = 96;

/** The activity chip's widest; past it, its words end in an ellipsis. */
export const CHIP_MAX_WIDTH = 220;

/** Whether a page `width` points wide gets the compact toolbar. */
export function isCompact(width: number): boolean {
  return width < COMPACT_BELOW;
}
