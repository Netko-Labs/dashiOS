/**
 * How Calendar's window gives way as it narrows (review 54): the sidebar
 * folds to a rail of calendar dots first, then Day / Week / Month folds into
 * one pop-up and the title takes its short form. ‹ Today ›, the view, Find and
 * + keep their places and their widths at every size; the title takes what is
 * left and ends in an ellipsis (view.tsx). Below `CALENDAR_LEAST` the window
 * goes no narrower or shorter. Pure.
 */

/** The window's least size: the rail, a week's seven columns of about 60 pt, and every toolbar control with the short title. */
export const CALENDAR_LEAST = { width: 520, height: 320 } as const;
/** Below this window width the sidebar is a rail of calendar dots. */
export const RAIL_BELOW = 640;
/** The rail: a 22 pt dot target in 17 either side. */
export const RAIL_WIDTH = 56;
/** The full sidebar, as `@dashi/ui`'s `SIDEBAR_WIDTH`. */
export const SIDEBAR_FULL = 200;

/** The toolbar's controls, as drawn: ‹ 32, Today 58, › 32, the view (segments or pop-up), Find 32 and + 32, 10 apart. */
const NAV = 32 + 10 + 58 + 10 + 32;
const SEGMENTS = 3 * 52 + 2 * 2 + 2 * 2;
export const VIEW_POPUP_WIDTH = 84;
const ENDS = 32 + 10 + 32;
/** The controls' width with the segments, and with the pop-up. */
export const CONTROLS_FULL = NAV + 10 + SEGMENTS + 10 + ENDS;
export const CONTROLS_COMPACT = NAV + 10 + VIEW_POPUP_WIDTH + 10 + ENDS;
/** The room the title keeps beside the segments before they fold into the pop-up ("Nov 8 – 14, 2026" in 13 bold). */
const TITLE_ROOM = 130;
/** The toolbar's insets: 12 at the right; at the left 18, or clear of the window controls (76) by 14 where the rail leaves them over the toolbar. */
const RIGHT_INSET = 12;
const CONTROLS_CLEAR = 76 + 14;

export interface CalendarChrome {
  /** The sidebar shows only its calendars, as dots. */
  rail: boolean;
  /** The sidebar's width. */
  sidebarWidth: number;
  /** Day / Week / Month is one pop-up, and the title is its short form. */
  compact: boolean;
}

/** The toolbar's room for the title and its controls in a window `width` wide with a sidebar `sidebar` wide. */
export function toolbarRoom(width: number, sidebar: number): number {
  return width - sidebar - Math.max(18, CONTROLS_CLEAR - sidebar) - RIGHT_INSET;
}

/** The chrome for a window `width` wide (0: not laid out yet, the full chrome). */
export function chromeFor(width: number): CalendarChrome {
  if (width <= 0) return { rail: false, sidebarWidth: SIDEBAR_FULL, compact: false };
  const rail = width < RAIL_BELOW;
  const sidebarWidth = rail ? RAIL_WIDTH : SIDEBAR_FULL;
  const compact = toolbarRoom(width, sidebarWidth) < CONTROLS_FULL + 10 + TITLE_ROOM;
  return { rail, sidebarWidth, compact };
}
