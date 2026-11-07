/**
 * Menu shortcuts as keys, the way a Mac does it: a chord pressed in an app
 * that published menus (protocol.ts) chooses the item that shows that
 * shortcut. The compositor reports the chord (IPC `binding` with the key's
 * keysym name and the modifiers); this turns it into Dashi's notation
 * ("⇧❖N") and finds the item. Both sides are normalized, so an app may write
 * "❖n" or "❖ N".
 */

import type { AppMenu } from "./protocol.ts";

export interface PressedChord {
  /** The unshifted key's xkb keysym name: "n", "comma", "BackSpace". */
  key: string;
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
}

/** Keysym names written as the Mac writes them in menus. */
const KEY_GLYPHS: Readonly<Record<string, string>> = {
  comma: ",",
  period: ".",
  slash: "/",
  backslash: "\\",
  semicolon: ";",
  apostrophe: "'",
  grave: "`",
  minus: "-",
  equal: "=",
  bracketleft: "[",
  bracketright: "]",
  space: "Space",
  Return: "↩",
  // biome-ignore lint/style/useNamingConvention: an xkb keysym name
  KP_Enter: "↩",
  BackSpace: "⌫",
  Delete: "⌦",
  Escape: "Esc",
  Tab: "⇥",
  Left: "←",
  Right: "→",
  Up: "↑",
  Down: "↓",
  Home: "↖",
  End: "↘",
  // biome-ignore lint/style/useNamingConvention: an xkb keysym name
  Page_Up: "⇞",
  // biome-ignore lint/style/useNamingConvention: an xkb keysym name
  Page_Down: "⇟",
};

/** Modifier glyphs in the Mac's order. */
const ORDER = ["⌃", "⌥", "⇧", "❖"] as const;

/** A shortcut in one spelling: modifiers in the Mac's order, then the key, letters capital. */
export function normalizeShortcut(text: string): string {
  const compact = text.replace(/\s+/g, "");
  const modifiers = ORDER.filter((glyph) => compact.includes(glyph));
  let key = compact;
  for (const glyph of ORDER) key = key.split(glyph).join("");
  return `${modifiers.join("")}${key.length === 1 ? key.toUpperCase() : key}`;
}

/** The pressed chord in Dashi's notation (always with ❖, the chords this is for), or null for a key with no glyph. */
export function chordText(chord: PressedChord): string | null {
  const key = /^[a-z0-9]$/i.test(chord.key) ? chord.key.toUpperCase() : (KEY_GLYPHS[chord.key] ?? (/^F\d{1,2}$/.test(chord.key) ? chord.key : null));
  if (!key) return null;
  return `${chord.ctrl ? "⌃" : ""}${chord.alt ? "⌥" : ""}${chord.shift ? "⇧" : ""}❖${key}`;
}

const KEYSYMS: ReadonlyMap<string, string> = (() => {
  const names = new Map<string, string>();
  // "↩" is both Return and KP_Enter: the first wins.
  for (const [name, glyph] of Object.entries(KEY_GLYPHS)) if (!names.has(glyph)) names.set(glyph, name);
  return names;
})();

/**
 * The chord a shortcut written Dashi's way asks for ("⇧❖Z" is Shift+Super+z),
 * or null for text that is not a ❖ chord of a key this knows ("Esc", "⌫").
 * The inverse of `chordText`, so a menu's shortcuts can be checked against the
 * keymap (reserved.ts).
 */
export function chordFromShortcut(text: string): PressedChord | null {
  const shortcut = normalizeShortcut(text);
  if (!shortcut.includes("❖")) return null;
  let key = shortcut;
  for (const glyph of ORDER) key = key.split(glyph).join("");
  const name = /^[A-Z0-9]$/.test(key) ? key.toLowerCase() : (KEYSYMS.get(key) ?? (/^F\d{1,2}$/.test(key) ? key : null));
  if (name === null) return null;
  return { key: name, shift: shortcut.includes("⇧"), ctrl: shortcut.includes("⌃"), alt: shortcut.includes("⌥") };
}

/**
 * The chords a text field answers itself: Select All, Copy, Cut, Paste, Undo,
 * Redo, and ❖⌫ (erase to the line's start). While a field has the keyboard (protocol.ts `typing`) they go to
 * it, not to the app's rows that show them.
 */
export const TEXT_SHORTCUTS: ReadonlySet<string> = new Set(["❖A", "❖C", "❖X", "❖V", "❖Z", "⇧❖Z", "❖⌫"]);

/** Whether `shortcut` is one a focused text field answers itself. */
export function isTextShortcut(shortcut: string): boolean {
  return TEXT_SHORTCUTS.has(normalizeShortcut(shortcut));
}

/** The enabled item of `menus` that shows `shortcut`, if any. */
export function itemForShortcut(menus: readonly AppMenu[], shortcut: string): string | null {
  const wanted = normalizeShortcut(shortcut);
  for (const menu of menus) {
    for (const row of menu.items) {
      if (row.kind === "separator") continue;
      if (row.enabled && row.shortcut !== undefined && normalizeShortcut(row.shortcut) === wanted) return row.id;
    }
  }
  return null;
}
