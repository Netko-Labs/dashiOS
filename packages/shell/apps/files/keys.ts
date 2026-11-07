/**
 * A file browser's keys (Files, and every chooser built on it), from the
 * keys the window gets when nothing else takes them (Metal's
 * `onWindowKeyDown`, GPUI's key names): the arrows in two directions with ⇧
 * extending, Home, End and the page keys, Return to open, ⌫ back, Delete to
 * the Trash, F2 to rename in place, Space to peek, Esc to clear the
 * selection, and typing to jump to a name. ❖↑ and ❖↓ arrive as Ctrl+Home and
 * Ctrl+End (the keymap turns them so for text, src/keymap.ts): Enclosing
 * Folder and Open. Other ❖ chords are the menus' (appmenus.ts).
 */

import type { WindowKeyInfo } from "@mirinjs/metal";
import type { Step } from "./selection.ts";

export type BrowserKey =
  | { kind: "move"; step: Step; extend: boolean }
  | { kind: "open" }
  | { kind: "enclosing" }
  | { kind: "back" }
  | { kind: "rename" }
  | { kind: "trash" }
  | { kind: "peek" }
  | { kind: "clear" }
  /** Characters typed, or text pasted (Ctrl+V). */
  | { kind: "text"; text: string };

const STEPS: Readonly<Record<string, Step>> = {
  left: "left",
  right: "right",
  up: "up",
  down: "down",
  home: "home",
  end: "end",
  pageup: "page-up",
  pagedown: "page-down",
};

const isControl = (char: string): boolean => char < " " || char === "\u007f";

/** What a key means to a browser, or null for one it leaves alone. */
export function browserKey(key: WindowKeyInfo): BrowserKey | null {
  if (key.pasted !== undefined) return key.pasted === "" ? null : { kind: "text", text: key.pasted };
  if (key.meta || key.alt) return null;
  if (key.ctrl) {
    if (key.key === "home") return { kind: "enclosing" };
    if (key.key === "end") return { kind: "open" };
    return null;
  }
  const step = STEPS[key.key];
  if (step) return { kind: "move", step, extend: key.shift };
  switch (key.key) {
    case "enter":
      return { kind: "open" };
    case "backspace":
      return { kind: "back" };
    case "delete":
      return { kind: "trash" };
    case "f2":
      return { kind: "rename" };
    case "space":
      return { kind: "peek" };
    case "escape":
      return { kind: "clear" };
  }
  const text = key.text ?? "";
  return text !== "" && ![...text].some(isControl) ? { kind: "text", text } : null;
}
