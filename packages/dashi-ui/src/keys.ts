/**
 * Keys for a window with nothing to type into. Metal hands the keys no
 * focused control takes to the window's KeySink (key-sink.tsx, Metal's
 * `onWindowKeyDown`): every key while nothing has the keyboard, and the
 * ones a focused button or switch doesn't use (Tab and the arrows in a
 * group move the focus, Space and Return press it). `keyInputFor` turns
 * one into the few keys apps match: the text a key types (Ctrl+V's is the
 * clipboard's), Backspace, Return, Esc, and the up and down arrows.
 */

import type { WindowKeyInfo } from "@mirinjs/metal";

export type KeyInput =
  /** Characters typed or pasted. */
  { kind: "text"; text: string } | { kind: "backspace" } | { kind: "enter" } | { kind: "escape" } | { kind: "up" } | { kind: "down" };

const NAMED: Readonly<Record<string, KeyInput>> = {
  enter: { kind: "enter" },
  escape: { kind: "escape" },
  backspace: { kind: "backspace" },
  up: { kind: "up" },
  down: { kind: "down" },
};

/** A control character, or Delete: typed by no key an app matches as text. */
const isControl = (char: string): boolean => char < " " || char === "\u007f";

/**
 * What a key the window got stands for, or null for one apps don't match:
 * a chord with Ctrl, Alt, or Super is a shortcut, not typing (the menus
 * take those), except Ctrl+V, which pastes the clipboard's text.
 */
export function keyInputFor(key: WindowKeyInfo): KeyInput | null {
  if (key.pasted !== undefined) return key.pasted === "" ? null : { kind: "text", text: key.pasted };
  if (key.ctrl || key.alt || key.meta) return null;
  const named = NAMED[key.key];
  if (named) return named;
  const text = key.text ?? "";
  return text !== "" && ![...text].some(isControl) ? { kind: "text", text } : null;
}

/** A typed character as a key name the app can match: "a", "5", "+", "Enter", "Backspace". */
export function keyName(input: KeyInput): string {
  switch (input.kind) {
    case "text":
      return input.text;
    case "backspace":
      return "Backspace";
    case "enter":
      return "Enter";
    case "escape":
      return "Escape";
    case "up":
      return "ArrowUp";
    case "down":
      return "ArrowDown";
  }
}
