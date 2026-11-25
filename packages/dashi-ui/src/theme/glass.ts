/**
 * The frosted-glass spike's tints (decisions.md D710, D713): what the compositor lays over the blur
 * behind a surface, raised where its words need it. A surface's own colour at 70%. Off by default
 * (`DASHI_GLASS`); the designers' directions will set them per material level.
 */

import { useDark } from "./appearance.ts";
import { lightColors, TRUE_BLACK } from "./palette.ts";

/** Each frosted surface's tint, by mode. */
export const GLASS_TINTS = {
  light: { launcher: `${lightColors.launcher}b3` },
  dark: { launcher: `${TRUE_BLACK.lift}b3` },
} as const;

/** The tints for the mode right now. */
export function useGlassTints(): { launcher: string } {
  return useDark() ? GLASS_TINTS.dark : GLASS_TINTS.light;
}
