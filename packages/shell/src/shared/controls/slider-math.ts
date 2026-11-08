/**
 * Control Center's sliders, as numbers: where the pointer is on a standing
 * (tall) or lying (flat) slider is its level, the ink fill is that share of
 * it, and ⇧ with an arrow steps it by a tenth. Pure, so the mapping is
 * tested apart from the drawing (tiles.tsx).
 */

/** An arrow's way (Control Center's grid names it the same). */
export type Direction = "left" | "right" | "up" | "down";

export interface SliderBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

const clamp = (value: number): number => Math.min(Math.max(value, 0), 1);

/**
 * The level at a pointer position: a tall slider fills from the bottom, so
 * the top is 1; a flat one from the left. Positions outside clamp.
 */
export function levelAt(box: SliderBox, x: number, y: number, standing: boolean): number {
  if (standing) return box.height <= 0 ? 0 : clamp(1 - (y - box.y) / box.height);
  return box.width <= 0 ? 0 : clamp((x - box.x) / box.width);
}

/** The ink's length along the slider for a level: whole points, never past the slider. */
export const fillLength = (level: number, length: number): number => Math.round(clamp(level) * Math.max(length, 0));

/** ⇧ and an arrow on a focused slider: up and right raise it a tenth, down and left lower it; the result lands on a tenth. */
export function stepLevel(level: number, direction: Direction): number {
  const step = direction === "up" || direction === "right" ? 1 : -1;
  return clamp(Math.round(clamp(level) * 10 + step) / 10);
}
