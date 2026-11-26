/**
 * The menu bar's washes on thin glass (design.html DE-4, UI-18; frost-objects board 01, D780): an item has
 * no fill at rest, the ink at 8 % under the pointer and 14 % while its menu is open; a chip (BarItem) is a
 * pill on its tone's wash with primary words: neutral ink 10 % (16 % under the pointer), the agents' shiso
 * as `agentWash`, a capture's ume at 20 % (28 %). The ink is the glass's primary, so the washes lean with
 * the words (GL-1). Nothing in the bar is the accent: nothing in it is chosen or on.
 */

import { withAlpha } from "@dashi/ui";

/** How much of the ink each wash takes. */
export const BAR_WASH = { hover: 0.08, open: 0.14, chip: 0.1, chipHover: 0.16, capture: 0.2, captureHover: 0.28, agentHover: 0.3 } as const;

export interface BarWashes {
  /** An item under the pointer. */
  hover: string;
  /** An item whose menu or panel is open. */
  open: string;
  /** A neutral chip (a tally capsule, the voice's notice). */
  chip: string;
  chipHover: string;
}

/** The washes for words of `ink` (the bar's primary on glass, `colors.text`). */
export function barWashes(ink: string): BarWashes {
  return {
    hover: withAlpha(ink, BAR_WASH.hover),
    open: withAlpha(ink, BAR_WASH.open),
    chip: withAlpha(ink, BAR_WASH.chip),
    chipHover: withAlpha(ink, BAR_WASH.chipHover),
  };
}
