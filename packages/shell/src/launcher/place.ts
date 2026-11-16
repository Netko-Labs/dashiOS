/**
 * Where the launcher's surface goes on a screen, and how tall it is
 * (docs/design.html LA-1): 120 points under the menu bar and 600 tall where
 * there is room. On a short screen (1280×800 at 125%, the VM's 1098×686) the
 * gap above shrinks first, to no less than the gap kept below it; then the
 * surface itself is shorter, and the list lists fewer rows (measures.ts), so
 * its foot never runs off the screen's edge (passes 41 and 42).
 */

import { SURFACE } from "./lib/measures.ts";

/** Under the menu bar, where there is room. */
export const LAUNCHER_TOP = 120;
/** Kept free under the launcher's foot, and over its head at least. */
export const LAUNCHER_GAP = 12;
/** However short the screen, the field and a few rows. */
const LEAST_HEIGHT = 240;

export interface LauncherPlace {
  /** From the top of the usable area (under the menu bar). */
  top: number;
  height: number;
}

/** The launcher on a screen with `below` points from the menu bar's foot to the screen's bottom edge. */
export function launcherPlace(below: number | undefined): LauncherPlace {
  if (below === undefined || !Number.isFinite(below)) return { top: LAUNCHER_TOP, height: SURFACE.height };
  const height = Math.max(LEAST_HEIGHT, Math.min(SURFACE.height, Math.floor(below) - 2 * LAUNCHER_GAP));
  const top = Math.max(LAUNCHER_GAP, Math.min(LAUNCHER_TOP, Math.floor(below) - height - LAUNCHER_GAP));
  return { top, height };
}
