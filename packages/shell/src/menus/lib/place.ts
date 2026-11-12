/**
 * Where the shell's dropdown goes on its screen (docs/design.html, "Menu",
 * PA-9): a menu-bar title's opens at its title, a status item's ends at the
 * item's right edge, the Dock's is centered over the icon. Each stays 6 in
 * from the screen's sides; one taller than the room under the bar (or over
 * the Dock) is as tall as that room allows and its rows scroll. The room is
 * the popover surface: the screen under the menu bar.
 */

import { MENU, type Size } from "@dashi/ui";

/** The dropdown's width when it hasn't been drawn yet, and at most. */
export const DROPDOWN = { minWidth: 230, maxWidth: 360, top: 2 } as const;

/** What the dropdown hangs from: `x` is its left edge (`start`), right edge (`end`), or center (`above`, `bottom` over the screen's foot). */
export type DropdownAnchor = { kind: "start"; x: number } | { kind: "end"; x: number } | { kind: "above"; x: number; bottom: number };

export interface DropdownPlace {
  left: number;
  /** From the top of the surface (`start`, `end`). */
  top?: number;
  /** From the foot of the surface (`above`). */
  bottom?: number;
  /** Set when the menu is taller than its room: it is drawn this tall, its rows scrolling. */
  maxHeight?: number;
}

/**
 * The dropdown's place for a menu `size` big (its width as last drawn, its
 * height from its rows) in `room` (0 while not known: nothing to keep it in).
 */
export function placeDropdown(anchor: DropdownAnchor, size: Size, room: Size): DropdownPlace {
  const wanted = anchor.kind === "start" ? anchor.x : anchor.kind === "end" ? anchor.x - size.width : anchor.x - size.width / 2;
  const left = Math.round(room.width > 0 ? Math.max(MENU.margin, Math.min(wanted, room.width - MENU.margin - size.width)) : wanted);
  const tall = anchor.kind === "above" ? room.height - anchor.bottom - MENU.margin : room.height - DROPDOWN.top - MENU.margin;
  const cap = room.height > 0 && size.height > tall ? { maxHeight: Math.max(MENU.row + 2 * (MENU.padding + MENU.edge), Math.floor(tall)) } : {};
  return anchor.kind === "above" ? { left, bottom: anchor.bottom, ...cap } : { left, top: DROPDOWN.top, ...cap };
}
