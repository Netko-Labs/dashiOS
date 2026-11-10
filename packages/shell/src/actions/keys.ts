/**
 * The key an address is bound to in the keymap (keymap.ts), written Dashi's
 * way, so a row can show it: `super+ctrl+Left` is "⌃❖←". A rule binds an
 * address when its `bind` is one (docs/actions.md, "The keymap").
 */

import type { Keymap } from "../keymap/keymap.ts";

const GLYPHS: Readonly<Record<string, string>> = {
  Left: "←",
  Right: "→",
  Up: "↑",
  Down: "↓",
  Return: "↩",
  Escape: "Esc",
  BackSpace: "⌫",
  Delete: "⌦",
  Tab: "⇥",
  space: "Space",
  comma: ",",
  period: ".",
  grave: "`",
};

/** `super+ctrl+Left` (or `…+Return|KP_Enter`) as "⌃❖←"; null for a rule that is not one chord (`letter`, `*`). */
export function chordGlyphs(when: string): string | null {
  const tokens = when.split("+");
  const key = (tokens.pop() ?? "").split("|")[0] ?? "";
  if (key === "" || key === "*" || key === "letter") return null;
  const glyph = GLYPHS[key] ?? (/^[a-z0-9]$/i.test(key) ? key.toUpperCase() : /^F\d{1,2}$/.test(key) ? key : null);
  if (glyph === null) return null;
  const mods = [
    tokens.includes("ctrl") ? "⌃" : "",
    tokens.includes("alt") ? "⌥" : "",
    tokens.includes("shift") ? "⇧" : "",
    tokens.includes("super") ? "❖" : "",
  ];
  return `${mods.join("")}${glyph}`;
}

/** The first chord the keymap binds to `address`, or undefined. */
export function keyFor(address: string, keymap: Keymap): string | undefined {
  for (const rule of keymap.rules) {
    if (rule.bind !== address || rule.app !== undefined) continue;
    const glyphs = chordGlyphs(rule.when);
    if (glyphs) return glyphs;
  }
  return undefined;
}
