/**
 * A slider's arithmetic: where a pointer is on the bar, the value it stands
 * for (snapped to the step, so a setting is never saved as
 * 0.30000000000000004), and how much of the bar is filled. The knob has a
 * width of its own, so at the minimum the fill is half a knob (or a whole
 * one, when the fill is the knob) and the pointer holds the knob's center.
 */

export interface SliderRange {
  min: number;
  max: number;
  /** 0 for a value that isn't snapped (a level from 0 to 1). */
  step: number;
}

/** A level from 0 to 1, unsnapped: volume, brightness. */
export const UNIT_RANGE: SliderRange = { min: 0, max: 1, step: 0 };

/** Where `value` sits on the bar, 0 to 1. */
export function fractionOf(value: number, { min, max }: SliderRange): number {
  if (max <= min) return 0;
  return Math.min(Math.max((value - min) / (max - min), 0), 1);
}

/** Decimal places a step needs (0.05 → 2). */
function places(step: number): number {
  const text = String(step);
  const dot = text.indexOf(".");
  return dot < 0 ? 0 : text.length - dot - 1;
}

/** The value for a position on the bar (0 to 1): snapped to the step, inside the range. */
export function valueAt(fraction: number, range: SliderRange): number {
  const { min, max, step } = range;
  const raw = min + Math.min(Math.max(fraction, 0), 1) * (max - min);
  if (step <= 0) return raw;
  const snapped = min + Math.round((raw - min) / step) * step;
  return Number(Math.min(Math.max(snapped, min), max).toFixed(places(step)));
}

/** A pointer at window pixel `x` over a bar with these bounds, as 0 to 1 with the knob's center under it. */
export function fractionAt(x: number, bar: { x: number; width: number }, knob: number): number {
  const travel = bar.width - knob;
  if (travel <= 0) return 0;
  return Math.min(Math.max((x - bar.x - knob / 2) / travel, 0), 1);
}

/** The knob's left edge for a fraction, on a bar `width` wide. */
export function knobLeft(fraction: number, width: number, knob: number): number {
  return Math.min(Math.max(fraction, 0), 1) * Math.max(width - knob, 0);
}

/** At most this many values for the arrows on a slider whose step is fine or free (about 5% a press). */
const KEY_NOTCHES = 21;

/**
 * The values the arrow keys step through: every step when there are few,
 * else a whole number of steps about 5% of the bar apart; a free slider
 * (step 0) goes in 5%. Always from the minimum to the maximum.
 */
export function keyValues(range: SliderRange): number[] {
  const { min, max, step } = range;
  if (max <= min) return [min];
  const span = max - min;
  const stride = step > 0 ? step * Math.max(1, Math.ceil(span / step / (KEY_NOTCHES - 1))) : span / (KEY_NOTCHES - 1);
  const count = Math.floor(span / stride + 1e-9);
  const values = Array.from({ length: count + 1 }, (_, index) => valueAt((index * stride) / span, range));
  if (values.at(-1) !== max) values.push(max);
  return values;
}

/** Where in `values` the one nearest `value` is: the arrows step on from there. */
export function nearestIndex(values: readonly number[], value: number): number {
  let best = 0;
  for (const [index, candidate] of values.entries()) {
    if (Math.abs(candidate - value) < Math.abs((values[best] ?? candidate) - value)) best = index;
  }
  return best;
}

/* Control Center's sliders (the panel look's InkSlider): where the pointer is on a standing or lying slider is its level, the ink fill that share of it, and ⇧ with an arrow steps it by a tenth. */

/** An arrow's way (Control Center's grid names it the same). */
export type Direction = "left" | "right" | "up" | "down";

export interface SliderBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

const clampUnit = (value: number): number => Math.min(Math.max(value, 0), 1);

/**
 * The level at a pointer position: a tall slider fills from the bottom, so
 * the top is 1; a flat one from the left. Positions outside clamp.
 */
export function levelAt(box: SliderBox, x: number, y: number, standing: boolean): number {
  if (standing) return box.height <= 0 ? 0 : clampUnit(1 - (y - box.y) / box.height);
  return box.width <= 0 ? 0 : clampUnit((x - box.x) / box.width);
}

/** The ink's length along the slider for a level: whole points, never past the slider. */
export const fillLength = (level: number, length: number): number => Math.round(clampUnit(level) * Math.max(length, 0));

/** ⇧ and an arrow on a focused slider: up and right raise it a tenth, down and left lower it; the result lands on a tenth. */
export function stepLevel(level: number, direction: Direction): number {
  const step = direction === "up" || direction === "right" ? 1 : -1;
  return clampUnit(Math.round(clampUnit(level) * 10 + step) / 10);
}
