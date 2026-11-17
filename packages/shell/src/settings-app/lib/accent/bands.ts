/**
 * Where the guard's bands fall on the picker's hue strip (an HSV strip; the
 * guard works in OKLCH): the tally's band and the agents', as fractions of
 * the strip's width, for the grey marks under it, so the person sees them
 * before picking (@dashi/ui `isGuardedHue`).
 */

import { isGuardedHue } from "@dashi/ui";
import { hexOf, hsvToRgb } from "./images.ts";

export interface Band {
  from: number;
  to: number;
}

/** The marked stretches of the strip, left to right. */
export function bandsUnderStrip(steps = 360): Band[] {
  const bands: Band[] = [];
  let open: number | null = null;
  for (let i = 0; i <= steps; i++) {
    const kept = i < steps && isGuardedHue(hexOf(hsvToRgb((i / steps) * 360, 1, 1)));
    if (kept && open === null) open = i / steps;
    if (!kept && open !== null) {
      bands.push({ from: open, to: i / steps });
      open = null;
    }
  }
  return bands;
}
