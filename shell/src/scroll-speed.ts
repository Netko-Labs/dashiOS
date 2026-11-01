/**
 * Scrolling speed, a factor on how far a scroll moves: 1 is what the device
 * sends, 2 is twice as far. dashi-comp multiplies the scroll events by it,
 * for touchpads and mice separately (comp/src/devices/scroll.rs); the range
 * is the compositor's too.
 *
 * The factor is multiplicative, so people feel it on a logarithmic scale:
 * Settings' slider is linear in the factor's base-2 logarithm, which puts 1
 * in the middle with 0.25 and 4 at the ends.
 */

export const SCROLL_SPEED_MIN = 0.25;
export const SCROLL_SPEED_MAX = 4;
/** The factor with no setting. */
export const SCROLL_SPEED_DEFAULT = 1;

export const isScrollSpeed = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= SCROLL_SPEED_MIN && value <= SCROLL_SPEED_MAX;

/** A slider position for a factor: its base-2 logarithm, -2 (0.25) through 0 (1) to 2 (4). */
export const scrollSpeedPosition = (factor: number): number => Math.log2(Math.min(Math.max(factor, SCROLL_SPEED_MIN), SCROLL_SPEED_MAX));

/** The factor for a slider position, to two decimals (so 1 is exactly 1, and the file never holds 1.0905077326652577). */
export function scrollSpeedAt(position: number): number {
  const factor = Number((2 ** position).toFixed(2));
  return Math.min(Math.max(factor, SCROLL_SPEED_MIN), SCROLL_SPEED_MAX);
}
