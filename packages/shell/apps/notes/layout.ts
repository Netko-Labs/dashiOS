/**
 * How Notes' window gives way as it narrows (review 54): the note is what
 * the window is for, so the furniture yields first. Below RAIL_BELOW the
 * folders fold to a rail of glyphs (each named by its tooltip); below
 * NARROW_BELOW the list narrows and Recently Deleted's toolbar keeps its
 * glyphs and drops its words. The window is never narrower than
 * NOTES_MIN_SIZE, where the note still has a column to write in. And the
 * line over a note says its date in the longest form that fits on one line.
 * Pure.
 */

/** The least window: at 520 the rail, a 220 list and a 244 note fit; a tile at half a 1080 screen is wider. */
export const NOTES_MIN_SIZE = { width: 520, height: 400 } as const;
/** Below this window width the sidebar is a rail of glyphs. */
export const RAIL_BELOW = 800;
/** Below this window width the list is LIST_NARROW and the toolbar drops its words. */
export const NARROW_BELOW = 640;
/** The rail's width: a 16 px glyph in a 36 px row, 10 either side (Files' rail too). */
export const RAIL_WIDTH = 56;
export const LIST_WIDTH = 276;
export const LIST_NARROW = 220;
/** The search field gives way to this before anything else in the toolbar moves. */
export const SEARCH_MIN = 88;

export interface NotesLayout {
  /** The folders show only their glyphs, their names as tooltips. */
  rail: boolean;
  /** The note list's width. */
  listWidth: number;
  /** Toolbar buttons show only their glyphs (Recently Deleted's Restore, Delete). */
  compact: boolean;
}

/** The layout for a window `width` wide (0: not laid out yet, the full one). */
export function notesLayout(width: number): NotesLayout {
  if (width <= 0) return { rail: false, listWidth: LIST_WIDTH, compact: false };
  const narrow = width < NARROW_BELOW;
  return { rail: width < RAIL_BELOW, listWidth: narrow ? LIST_NARROW : LIST_WIDTH, compact: narrow };
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
