/**
 * Which tabs the title bar's strip shows (tab-strip.tsx). Each keeps at
 * least TAB_MIN, so a name is never two letters; the ones that don't fit
 * fold into a count after the last shown ("+3"), whose menu lists them
 * all. The tab in front is always among those shown, so a narrow window
 * keeps its name, never a lone ×.
 */

/** A tab's least width: the ×, about eight letters of its name, and the dot's room. */
export const TAB_MIN = 96;
/** And its most: two tabs don't stretch across a wide window; the group sits centred. */
export const TAB_MAX = 260;
/** The space between two tabs, and before the count. */
export const TAB_GAP = 4;
/** The count's width ("+5"). */
export const MORE_WIDTH = 34;

export interface StripFit {
  /** The first tab shown, by its place in the list. */
  start: number;
  /** One past the last shown. */
  end: number;
  /** How many fold into the count (0: all show, no count). */
  hidden: number;
}

/**
 * The tabs `width` holds, `front` (an index) among them. Before the strip
 * is measured (`width` null) every tab shows, as one frame's guess.
 */
export function fitTabs(count: number, front: number, width: number | null): StripFit {
  if (count <= 0) return { start: 0, end: 0, hidden: 0 };
  if (width === null || count * TAB_MIN + (count - 1) * TAB_GAP <= width) return { start: 0, end: count, hidden: 0 };
  // Each shown tab takes its least width and a gap; the count takes the rest.
  // At least the one in front, however narrow; never all of them here (they would have fit above), unless there is only one.
  const shown = Math.max(1, Math.min(count - 1, Math.floor((width - MORE_WIDTH) / (TAB_MIN + TAB_GAP))));
  const at = Math.min(Math.max(front, 0), count - 1);
  // From the first tab while the one in front is among them; else the one in front ends the run.
  const start = at < shown ? 0 : at - shown + 1;
  return { start, end: start + shown, hidden: count - shown };
}
