/**
 * How the Store's one toolbar row fits a narrow window (VS-1: one chrome row,
 * nothing spills out of it). Under `COMPACT_BELOW` points for the page (the
 * window less its sidebar), the row gives way in a set order: the window's
 * name goes (`hideTitle`: the sidebar says where you are), Check for updates
 * and Catalogs… become their glyphs with a tooltip, the activity chip drops
 * the app's name but keeps its progress, and the search field shrinks to the
 * kit's least width last of all (SearchField, UI-11). Below `STORE_LEAST` the
 * window goes no smaller (LA-3).
 */

import { SEARCH_FIELD, SIDEBAR_WIDTH, SPACE } from "@dashi/ui";

/** Room for the page, in points, under which the toolbar is compact. */
export const COMPACT_BELOW = 600;

/** The activity chip's widest; past it, its words end in an ellipsis. */
export const CHIP_MAX_WIDTH = 220;

/**
 * The compact row at its fullest, as drawn: 18 in after the sidebar, Back
 * 32, the stale chip's "Offline" about 80, the activity chip's short words
 * ("Installing 42%") about 90, a glyph button 32, the search field at its
 * least, five gaps of 10, and 12 at the end.
 */
const COMPACT_ROW = 18 + 32 + 80 + 90 + 32 + SEARCH_FIELD.least + 5 * SPACE.gap + 12;

/**
 * The window's least size: the sidebar beside that row, and a page tall
 * enough for a sheet's question and buttons under the toolbar (the sidebar's
 * rows scroll in their own column).
 */
export const STORE_LEAST = { width: SIDEBAR_WIDTH + COMPACT_ROW, height: 400 } as const;

/** Whether a page `width` points wide gets the compact toolbar. */
export function isCompact(width: number): boolean {
  return width < COMPACT_BELOW;
}
