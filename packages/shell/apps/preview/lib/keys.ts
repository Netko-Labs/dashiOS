/**
 * Preview's bare keys, the ones that move around what is open; everything
 * else is a ❖ chord on a menu row (menus.ts), so the menus, the toolbar and
 * the keyboard agree. In a PDF ↑ ↓ scroll, Page Up and Page Down, Space and
 * ⇧Space scroll a screen, Home and End go to the ends, and ← → go to the
 * previous and next page; among pictures every arrow steps through the
 * folder. ⌫ asks to move the file to the Trash (File › Move to Trash shows
 * it), and Esc lets go of selected text. Pure: the window does what this says.
 */

import type { WindowKeyInfo } from "@mirinjs/metal";

export type KeyAction =
  | { kind: "scroll"; by: "line" | "screen"; direction: 1 | -1 }
  | { kind: "end"; direction: 1 | -1 }
  | { kind: "step"; direction: 1 | -1 }
  | { kind: "trash" }
  | { kind: "unselect" };

export function keyAction(key: Pick<WindowKeyInfo, "key" | "ctrl" | "alt" | "meta" | "shift">, isPdf: boolean): KeyAction | null {
  // Chords are the menus' (the shell chooses the row that shows one).
  if (key.ctrl || key.alt || key.meta) return null;
  switch (key.key) {
    case "left":
      return { kind: "step", direction: -1 };
    case "right":
      return { kind: "step", direction: 1 };
    case "up":
      return isPdf ? { kind: "scroll", by: "line", direction: -1 } : { kind: "step", direction: -1 };
    case "down":
      return isPdf ? { kind: "scroll", by: "line", direction: 1 } : { kind: "step", direction: 1 };
    case "pageup":
      return isPdf ? { kind: "scroll", by: "screen", direction: -1 } : { kind: "step", direction: -1 };
    case "pagedown":
      return isPdf ? { kind: "scroll", by: "screen", direction: 1 } : { kind: "step", direction: 1 };
    case "space":
      return isPdf ? { kind: "scroll", by: "screen", direction: key.shift ? -1 : 1 } : null;
    case "home":
      return isPdf ? { kind: "end", direction: -1 } : null;
    case "end":
      return isPdf ? { kind: "end", direction: 1 } : null;
    case "backspace":
    case "delete":
      return { kind: "trash" };
    case "escape":
      return { kind: "unselect" };
    default:
      return null;
  }
}
