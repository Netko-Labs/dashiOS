/**
 * How the Inks print a number (round five, #12 to #14): Inter Display, its
 * weight following the value in steps of 100 from 300 to 500, never under
 * 400 below 40 points; units Regular. The lock's, the login screen's and
 * Glance's clock is @dashi/ui's InksClock, at 200 (D670).
 * Only on a host that draws light weights and the display cut (mirin PR #55,
 * `fontWeights` and `displayFont`); an older host refuses the tree, so there
 * the number is Regular, and Medium when big and near its end, as before.
 */

import { WEIGHT } from "@dashi/ui";
import type { TextStyle } from "@mirinjs/metal";
import type { HostAbilities } from "../../shared/metal/index.ts";

/** Whether the host draws Inter Display at any weight. */
export function printsDisplay(abilities: HostAbilities): boolean {
  return abilities.fontWeights && abilities.displayFont;
}

/** The weight of a number `size` points high, `value` 0–1 of the way along (0: its floor). */
export function numberWeight(size: number, value: number): "300" | "400" | "500" {
  const floor = size < 40 ? 400 : 300;
  const steps = 300 + Math.round(Math.max(0, Math.min(1, value)) * 2) * 100;
  const weight = Math.max(floor, steps);
  return weight >= 500 ? "500" : weight >= 400 ? "400" : "300";
}

/** The face of a number: Inter Display at its weight, or Regular (Medium when big and near its end) on an older host. */
export function numberFace(abilities: HostAbilities, size: number, value: number): Pick<TextStyle, "fontFamily" | "fontWeight"> {
  if (printsDisplay(abilities)) return { fontFamily: "display", fontWeight: numberWeight(size, value) };
  return size >= 40 && value >= 0.75 ? { fontWeight: WEIGHT.display.medium } : {};
}

/** A number's unit: Regular, in the number's family. */
export function unitFace(abilities: HostAbilities): Pick<TextStyle, "fontFamily"> {
  return printsDisplay(abilities) ? { fontFamily: "display" } : {};
}
