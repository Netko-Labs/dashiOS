/**
 * How Notes' window gives way as it narrows (review 54): the note is what
 * the window is for, so the furniture yields first. Below RAIL_BELOW the
 * folders fold to the kit's rail of glyphs (each named by its tooltip); below
 * NARROW_BELOW the list narrows. The window is never narrower than
 * NOTES_MIN_SIZE, where the note still has a column to write in. And the
 * line over a note says its date in the longest form that fits on one line.
 * Pure.
 */

import { SIDEBAR, SIDEBAR_WIDTH, SPACE } from "@dashi/ui";

/** The least window: at 520 the rail, a 220 list and a 244 note fit; a tile at half a 1080 screen is wider. */
export const NOTES_MIN_SIZE = { width: 520, height: 400 } as const;
/** Below this window width the sidebar is a rail of glyphs. */
export const RAIL_BELOW = 800;
/** Below this window width the list is LIST_NARROW. */
export const NARROW_BELOW = 640;
/** The rail's width: the kit's (LA-5). */
export const RAIL_WIDTH = SIDEBAR.rail;
export const LIST_WIDTH = 276;
export const LIST_NARROW = 220;

export interface NotesLayout {
  /** The folders show only their glyphs, their names as tooltips. */
  rail: boolean;
  /** The note list's width. */
  listWidth: number;
}

/** The layout for a window `width` wide (0: not laid out yet, the full one). */
export function notesLayout(width: number): NotesLayout {
  if (width <= 0) return { rail: false, listWidth: LIST_WIDTH };
  return { rail: width < RAIL_BELOW, listWidth: width < NARROW_BELOW ? LIST_NARROW : LIST_WIDTH };
}

/** A notice's own bounds (`@dashi/ui`'s Notice). */
const NOTICE = { min: 240, max: 560 } as const;

/**
 * How wide a notice at the note's foot is in a window `width` wide: the
 * note's column less 8 at each side, at most 560, so it never reaches over
 * the list (at the least size, a notice's own least width, 240). A set width,
 * not a cap: its words are measured at the width they wrap to.
 */
export function noticeWidth(width: number): number {
  if (width <= 0) return NOTICE.max;
  const layout = notesLayout(width);
  const column = width - (layout.rail ? RAIL_WIDTH : SIDEBAR_WIDTH) - layout.listWidth;
  return Math.max(NOTICE.min, Math.min(NOTICE.max, column - 2 * SPACE.m));
}

/** How long a date is said: "November 9, 2026 at 1:24 AM", "Nov 9, 2026, 1:24 AM", "Nov 9". */
export type DateForm = "long" | "medium" | "short";

/** About how wide one character of the 11 pt line is, generously (digits and capitals included). */
const CHAR_WIDTH = 6.2;

/**
 * The line over a note, in the longest of its forms that fits `room` points
 * on one line (the shortest when none does: it is then cut with an ellipsis).
 */
export function fitLine(room: number, forms: readonly string[]): string {
  return forms.find((form) => form.length * CHAR_WIDTH <= room) ?? forms.at(-1) ?? "";
}
