/**
 * How Files' window gives way as it narrows (review 54): the sidebar becomes
 * a rail of glyphs first, then New Folder (and the Trash's Empty) leave the
 * toolbar for its "…" menu, which already holds them. Back, Forward, the
 * view switch and "…" stay whole at every width; the omnibox takes what is
 * left and folds its path (omnibox.tsx). Pure.
 */

/** Below this window width the sidebar is a rail of glyphs. */
export const RAIL_BELOW = 560;
/** Below this window width New Folder and Empty go into the toolbar's "…" menu. */
export const COMPACT_BELOW = 480;
/** The rail's width: a 16 px glyph in a 36 px row, 10 either side. */
export const RAIL_WIDTH = 56;

export interface WindowChrome {
  /** The sidebar shows only its glyphs, its names as tooltips. */
  rail: boolean;
  /** New Folder and Empty leave the toolbar (they stay in "…"). */
  compact: boolean;
}

/** The chrome for a window `width` wide (0: not laid out yet, the full chrome). */
export function chromeFor(width: number): WindowChrome {
  if (width <= 0) return { rail: false, compact: false };
  return { rail: width < RAIL_BELOW, compact: width < COMPACT_BELOW };
}
