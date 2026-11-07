/**
 * Where a menu goes (docs/design.html, PA-9): at the point that opened it,
 * flipped to the other side of it when it would run off the window, and
 * clamped inside the window when it fits on neither side. Its height is
 * known from its rows before it is drawn, so it never shows in the wrong
 * place first; its width is measured once it is.
 */

/** The menu's measures: its padding, a row, and a separator (a hairline with 4 above and below). */
export const MENU = { padding: 5, row: 24, separator: 9, edge: 1, minWidth: 160, margin: 6 } as const;

/** A row of a menu: an item, or the line between two groups of them. */
export type MenuRowKind = "item" | "separator";

/** The menu's height for these rows, padding and edge included. */
export function menuHeight(rows: readonly MenuRowKind[]): number {
  return rows.reduce((sum, row) => sum + (row === "separator" ? MENU.separator : MENU.row), 2 * (MENU.padding + MENU.edge));
}

/** How far the top of row `index` is below the top of the menu. */
export function rowTop(rows: readonly MenuRowKind[], index: number): number {
  return rows.slice(0, Math.max(0, index)).reduce((sum, row) => sum + (row === "separator" ? MENU.separator : MENU.row), MENU.padding + MENU.edge);
}

export interface Size {
  width: number;
  height: number;
}

/**
 * The menu's top-left for one opened at `at`, `size` big, in a window `room` big
 * (0 when not known yet: nothing to keep inside). With `flip`, a menu that
 * would run off the right or the bottom opens to the left of or above the
 * point; without it (a pop-up button's menu, over its button), it only slides in.
 */
export function placeMenu(at: { x: number; y: number }, size: Size, room: Size, flip = true): { x: number; y: number } {
  return { x: Math.round(axis(at.x, size.width, room.width, flip)), y: Math.round(axis(at.y, size.height, room.height, flip)) };
}

function axis(start: number, length: number, room: number, flip: boolean): number {
  if (room <= 0) return start;
  const last = room - MENU.margin;
  if (start + length <= last) return Math.max(start, MENU.margin);
  if (flip && start - length >= MENU.margin) return start - length;
  return Math.max(MENU.margin, last - length);
}

/**
 * The row ↑ (`step` -1) or ↓ (1) lights next among the rows that can be
 * picked (`usable`): the next one that way, stopping at the ends; from no
 * row, ↓ lights the first and ↑ the last, as on the Mac.
 */
export function litAfter(usable: readonly boolean[], lit: number | null, step: -1 | 1): number | null {
  const picks = usable.flatMap((ok, row) => (ok ? [row] : []));
  if (picks.length === 0) return null;
  if (lit === null) return (step > 0 ? picks[0] : picks.at(-1)) ?? null;
  const ahead = step > 0 ? picks.find((row) => row > lit) : picks.findLast((row) => row < lit);
  return ahead ?? lit;
}
