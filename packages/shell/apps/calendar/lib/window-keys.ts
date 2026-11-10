/**
 * Calendar's keys when nothing else takes them (no field, sheet, or popover):
 * the arrows move the picked day (← → a day, ↑ ↓ a week; a day in Day view),
 * Return opens the picked event or names a new one on the picked day, ⌫
 * deletes the picked event, Esc cancels a drag or lets go of what is picked;
 * N a new event, T today, 1 2 3 (or D W M) the views, [ and ] previous and
 * next. The ❖ chords are the menus' (menus.ts). Pure.
 */

import type { WindowKeyInfo } from "@mirinjs/metal";
import type { View } from "./layout.ts";

export type KeyAction =
  | { kind: "escape" }
  | { kind: "move"; days: number }
  | { kind: "enter" }
  | { kind: "delete" }
  | { kind: "new" }
  | { kind: "today" }
  | { kind: "view"; view: View }
  | { kind: "step"; direction: -1 | 1 };

const LETTERS: Readonly<Record<string, KeyAction>> = {
  n: { kind: "new" },
  t: { kind: "today" },
  "1": { kind: "view", view: "day" },
  d: { kind: "view", view: "day" },
  "2": { kind: "view", view: "week" },
  w: { kind: "view", view: "week" },
  "3": { kind: "view", view: "month" },
  m: { kind: "view", view: "month" },
  "[": { kind: "step", direction: -1 },
  "]": { kind: "step", direction: 1 },
};

/** What a key does in `view`; null for one Calendar leaves alone. */
export function keyAction(key: Pick<WindowKeyInfo, "key" | "text" | "ctrl" | "alt" | "meta">, view: View): KeyAction | null {
  if (key.ctrl || key.alt || key.meta) return null;
  const week = view === "day" ? 1 : 7;
  switch (key.key) {
    case "escape":
      return { kind: "escape" };
    case "left":
      return { kind: "move", days: -1 };
    case "right":
      return { kind: "move", days: 1 };
    case "up":
      return { kind: "move", days: -week };
    case "down":
      return { kind: "move", days: week };
    case "enter":
      return { kind: "enter" };
    case "backspace":
    case "delete":
      return { kind: "delete" };
  }
  return LETTERS[(key.text ?? "").toLowerCase()] ?? null;
}
