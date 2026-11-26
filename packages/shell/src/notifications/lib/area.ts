/**
 * The area's place on the screen, without the widgets it holds (place.ts has what needs them): the banner
 * stack reads it too, and must not load the widgets to know where the column stands.
 */

import { GLASS, SPACE } from "@dashi/ui";

/** The area's place: from the screen's right edge and the bar, and the room between its cards. */
export const AREA = { right: 12, top: 8, gap: SPACE.gap } as const;

/** Where the widget column's right edge stands from the screen's: the area's place and its padding. */
export const COLUMN_RIGHT = AREA.right + SPACE.xs;

/** Room left of the column for a card on air's glow (CO-12: blur and spread), so the area's list doesn't clip it. */
export const AREA_GLOW = GLASS.onAir.blur + GLASS.onAir.spread;
