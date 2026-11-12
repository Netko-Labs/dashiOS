/**
 * Where a menu goes (docs/design.html, PA-9): at the point that opened it,
 * flipped to the other side of it when it would run off the window, and
 * clamped inside the window when it fits on neither side. Its height is
 * known from its rows before it is drawn, so it never shows in the wrong
 * place first; its width is measured once it is.
 */

/**
 * Every menu's measures, in a window or from the menu bar (docs/design.html,
 * "Menu"): its padding, a row, and a separator (a hairline with 4 above and
 * below); a row's side inset, the tick's column and the gap after it, the
 * least room between a label and its shortcut, the shortcut's key column
 * (`Shortcut`'s `keyColumn`); the card's and a row's corners.
 */
export const MENU = {
  padding: 5,
  row: 24,
  separator: 9,
  edge: 1,
  minWidth: 160,
  margin: 6,
  inset: 8,
  tick: 12,
  tickGap: 6,
  keysGap: 24,
  keyColumn: 14,
  radius: 9,
  rowRadius: 5,
} as const;

/** How far right of the menu's outer edge its labels start: past the edge, the padding, a row's inset, and the ticks' column when it has one. */
export const menuLabelLeft = (ticks: boolean): number => MENU.edge + MENU.padding + MENU.inset + (ticks ? MENU.tick + MENU.tickGap : 0);

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
 * How tall the menu is drawn in a window `room` tall: its own height, or
 * the window less a margin above and below when it is taller, its rows
 * then scrolling (0 when the window is not known yet: its own height).
 */
export function menuFits(height: number, room: number): number {
  return room <= 0 ? height : Math.min(height, Math.max(room - 2 * MENU.margin, MENU.row + 2 * (MENU.padding + MENU.edge)));
}

/** A menu hung from a button keeps under it while this many rows fit there; fewer, and it slides up over the button. */
export const HUNG_ROWS = 4;

/**
 * How tall a menu hung under a button (`anchor` "end": a toolbar's or a
 * pill row's "More") is drawn when its top is at `top` in a window `room`
 * tall: the room under the button, less the margin, its rows scrolling, so
 * it never slides up over the button that opened it; its own height when
 * that fits, and `menuFits`' when not even HUNG_ROWS rows fit under it.
 */
export function hungHeight(height: number, top: number, room: number): number {
  if (room <= 0) return height;
  const under = Math.floor(room - top - MENU.margin);
  if (height <= under) return height;
  return under >= HUNG_ROWS * MENU.row + 2 * (MENU.padding + MENU.edge) ? under : menuFits(height, room);
}

/**
 * The most a menu may be wide in a window `room` wide (0: not known yet):
 * its own cap, if any, and never wider than the window less 6 a side, so a
 * long label ends in an ellipsis rather than off the window's edge.
 */
export function menuMaxWidth(own: number | undefined, room: number): number | undefined {
  const window = room > 0 ? Math.max(MENU.minWidth / 2, room - 2 * MENU.margin) : undefined;
  if (window === undefined) return own;
  return own === undefined ? window : Math.min(own, window);
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
