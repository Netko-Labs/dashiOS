/**
 * press: keys as the page hears them. The shell parses Dashi's notation
 * (agents/tools/keys.ts) into chords of xkb names; here each becomes the DOM's
 * `key` and `code`, and what the browser would do by default with it, which
 * the content script carries out when the page doesn't prevent it (the events
 * a page script dispatches are not the browser's own, so Enter would not
 * submit a form by itself).
 */

export interface PressChord {
  mods: ReadonlyArray<"super" | "ctrl" | "alt" | "shift">;
  /** An xkb keysym name: "Return", "Tab", "a". */
  key: string;
}

export type DefaultAction =
  | "activate" // Enter: submit the form, follow the link, press the button
  | "toggle" // Space on a button, checkbox or radio
  | "next-field"
  | "previous-field"
  | "erase-back"
  | "erase-forward"
  | "select-all"
  | { scroll: "up" | "down" | "left" | "right" | "page-up" | "page-down" | "top" | "bottom" }
  | { insert: string }
  | null;

export interface DomKey {
  key: string;
  code: string;
  keyCode: number;
}

const NAMED: Record<string, DomKey> = {
  Return: { key: "Enter", code: "Enter", keyCode: 13 },
  // biome-ignore lint/style/useNamingConvention: an xkb keysym name
  KP_Enter: { key: "Enter", code: "NumpadEnter", keyCode: 13 },
  Tab: { key: "Tab", code: "Tab", keyCode: 9 },
  // biome-ignore lint/style/useNamingConvention: an xkb keysym name
  ISO_Left_Tab: { key: "Tab", code: "Tab", keyCode: 9 },
  Escape: { key: "Escape", code: "Escape", keyCode: 27 },
  BackSpace: { key: "Backspace", code: "Backspace", keyCode: 8 },
  Delete: { key: "Delete", code: "Delete", keyCode: 46 },
  Left: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  Up: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  Right: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  Down: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  Prior: { key: "PageUp", code: "PageUp", keyCode: 33 },
  Next: { key: "PageDown", code: "PageDown", keyCode: 34 },
  Home: { key: "Home", code: "Home", keyCode: 36 },
  End: { key: "End", code: "End", keyCode: 35 },
  space: { key: " ", code: "Space", keyCode: 32 },
};

/** The DOM's key for a keysym; null for one the page can't be sent. */
export function domKey(chord: PressChord): DomKey | null {
  const named = NAMED[chord.key];
  if (named) return named;
  const f = /^F([1-9]|1[0-2])$/.exec(chord.key);
  if (f) return { key: chord.key, code: chord.key, keyCode: 111 + Number(f[1]) };
  if ([...chord.key].length !== 1) return null;
  const shifted = chord.mods.includes("shift");
  const key = shifted ? chord.key.toUpperCase() : chord.key;
  const upper = chord.key.toUpperCase();
  const code = /^[A-Z]$/.test(upper) ? `Key${upper}` : /^[0-9]$/.test(chord.key) ? `Digit${chord.key}` : "";
  return { key, code, keyCode: upper.charCodeAt(0) };
}

/** What the browser would do with a chord, `inField` when the focus is in a text field. */
export function defaultAction(chord: PressChord, inField: boolean, onControl: boolean): DefaultAction {
  const mods = new Set(chord.mods);
  const command = mods.has("super") || mods.has("ctrl");
  const dom = domKey(chord);
  if (!dom) return null;
  if (command) return dom.key.toLowerCase() === "a" && inField ? "select-all" : null;
  if (mods.has("alt")) return null;
  switch (dom.key) {
    case "Enter":
      return "activate";
    case "Tab":
      return mods.has("shift") ? "previous-field" : "next-field";
    case "Backspace":
      return inField ? "erase-back" : null;
    case "Delete":
      return inField ? "erase-forward" : null;
    case " ":
      if (inField) return { insert: " " };
      return onControl ? "toggle" : { scroll: mods.has("shift") ? "page-up" : "page-down" };
    case "ArrowUp":
    case "ArrowDown":
    case "ArrowLeft":
    case "ArrowRight":
      return inField ? null : { scroll: dom.key.slice(5).toLowerCase() as "up" | "down" | "left" | "right" };
    case "PageUp":
      return { scroll: "page-up" };
    case "PageDown":
      return { scroll: "page-down" };
    case "Home":
      return inField ? null : { scroll: "top" };
    case "End":
      return inField ? null : { scroll: "bottom" };
  }
  return inField && dom.key.length === 1 ? { insert: dom.key } : null;
}
