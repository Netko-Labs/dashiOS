/**
 * The palette to paint with: Light or Dark, with the person's accent drawn
 * into the keys it owns (accent/: selection and its steps, the washes, the
 * bar, `accentInk`, `onAccent`). Kombu, or no accent, is palette.ts's
 * constants themselves.
 */

import { drawAccent, isKombu } from "./accent/index.ts";
import { darkColors, lightColors, type Palette } from "./palette.ts";

const painted = new Map<string, Palette>();

/** The palette for the Dark Mode switch and the accent's seed (null or Kombu: the constants). */
export function paletteFor(dark: boolean, accent: string | null = null): Palette {
  const base = dark ? darkColors : lightColors;
  if (accent === null || isKombu(accent)) return base;
  const key = `${accent.toUpperCase()}|${dark}`;
  let palette = painted.get(key);
  if (!palette) {
    palette = { ...base, ...drawAccent(accent, dark).tokens };
    if (painted.size > 32) painted.clear();
    painted.set(key, palette);
  }
  return palette;
}
