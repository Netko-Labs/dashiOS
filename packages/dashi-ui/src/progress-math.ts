/**
 * The progress control's arithmetic (docs/design.html, PA-5): a bar's fill
 * for a fraction, where an indeterminate bar's sliding segment is at a
 * tick, and the spinner's spokes, each a step dimmer behind the lit one.
 * Metal can't rotate a view, so the spinner is a picture drawn again each
 * tick with the lit spoke moved on.
 */

/** How often the moving parts draw: smooth enough, and cheap (each tick sends a tree). */
export const PROGRESS_TICK_MS = 80;
/** One sweep of the indeterminate bar, there and back, in ticks. */
export const SWEEP_TICKS = 24;
/** The indeterminate bar's segment, as a share of the track. */
export const SEGMENT = 0.3;
export const SPOKES = 8;

/** The filled share for a fraction: inside 0 to 1, and a missing or unreadable one is none. */
export function clampFraction(value: number): number {
  return Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 0;
}

/** The segment's left edge, in pixels, on a track `width` wide, at `tick`: across and back once per sweep. */
export function sweepOffset(tick: number, width: number): number {
  const half = SWEEP_TICKS / 2;
  const at = ((tick % SWEEP_TICKS) + SWEEP_TICKS) % SWEEP_TICKS;
  const share = at <= half ? at / half : (SWEEP_TICKS - at) / half;
  return Math.round(share * width * (1 - SEGMENT));
}

/** Each spoke's opacity at `tick`: the lit one full, the ones behind it fading to a quarter. */
export function spokeOpacities(tick: number): number[] {
  const lit = ((tick % SPOKES) + SPOKES) % SPOKES;
  return Array.from({ length: SPOKES }, (_, spoke) => {
    const behind = (lit - spoke + SPOKES) % SPOKES;
    return Number((1 - (behind * 0.75) / (SPOKES - 1)).toFixed(3));
  });
}

/** The spinner's picture at `tick`, on a 16-unit grid (the Svg tints it). */
export function spinnerMarkup(tick: number): string {
  const spokes = spokeOpacities(tick)
    .map(
      (opacity, spoke) =>
        `<path d="M8 1.6v3.2" stroke="#000" stroke-width="1.8" stroke-linecap="round" stroke-opacity="${opacity}" transform="rotate(${(spoke * 360) / SPOKES} 8 8)"/>`,
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">${spokes}</svg>`;
}
