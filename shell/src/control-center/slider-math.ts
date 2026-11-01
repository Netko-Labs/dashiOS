/**
 * A slider is a bar with a round knob at the end of its fill. The knob has
 * a width of its own, so at 0 the fill is just the knob and at 1 it is the
 * whole bar; the pointer holds the knob's center.
 */

import type { Bounds } from "@mirinjs/metal";

export const KNOB = 28;

/** The value (0 to 1) for a pointer at window pixel `x` over a bar with these bounds. */
export function sliderValue(x: number, bounds: Bounds, knob: number = KNOB): number {
  const travel = bounds.width - knob;
  if (travel <= 0) return 0;
  return Math.min(Math.max((x - bounds.x - knob / 2) / travel, 0), 1);
}

/** The fill's width in pixels for a value, on a bar `width` wide. */
export function fillWidth(value: number, width: number, knob: number = KNOB): number {
  return knob + Math.min(Math.max(value, 0), 1) * Math.max(width - knob, 0);
}
