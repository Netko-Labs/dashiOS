/**
 * The geometry of a marquee (a press on empty space, dragged out into a
 * rectangle): the rectangle between two corners, which items it touches,
 * what the keys held make of them, the item it took last, and how fast it
 * scrolls the listing when the pointer is at or past an edge. Everything is
 * in the listing's content: pixels from the top left of what scrolls, so a
 * rectangle stays on its items while they scroll under the window. Pure.
 */

import type { Modifiers } from "@mirinjs/metal";

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A press that moved less than this, either way, is a click. */
export const MARQUEE_THRESHOLD = 4;
/** The band inside the top and bottom edges where a drag starts to scroll. */
export const EDGE = 24;
/** The fastest it scrolls, in pixels a tick (`TICK_MS`). */
export const MAX_STEP = 40;
/** How often it scrolls while the pointer is at an edge. */
export const TICK_MS = 16;

/** What a drag does to the selection it started with. */
export type MarqueeMode = "replace" | "add" | "toggle";

/**
 * The keys of a click, for a drag (selection.ts): none replaces the
 * selection, ⇧ adds to it (with ❖ too, as ⇧❖-click adds a run), and ❖ or
 * Ctrl alone toggles what the rectangle touches.
 */
export function modeOf(held: Modifiers): MarqueeMode {
  if (held.shift) return "add";
  return held.super || held.control ? "toggle" : "replace";
}

/** Whether the pointer went far enough from where it was pressed to be a drag. */
export function isDrag(from: Point, to: Point): boolean {
  return Math.abs(to.x - from.x) >= MARQUEE_THRESHOLD || Math.abs(to.y - from.y) >= MARQUEE_THRESHOLD;
}

/** The rectangle with `a` and `b` at opposite corners. */
export function rectBetween(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

/** Whether two rectangles touch: sharing an edge counts, so a rectangle with no area still takes the item it lies on. */
export function touches(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height;
}

/** The part of `rect` inside `frame`, or null when none of it is. */
export function clip(rect: Rect, frame: Rect): Rect | null {
  const x = Math.max(rect.x, frame.x);
  const y = Math.max(rect.y, frame.y);
  const right = Math.min(rect.x + rect.width, frame.x + frame.width);
  const bottom = Math.min(rect.y + rect.height, frame.y + frame.height);
  return right < x || bottom < y ? null : { x, y, width: right - x, height: bottom - y };
}

/** `point`, brought inside `frame`. */
export function clampTo(point: Point, frame: Rect): Point {
  return {
    x: Math.max(frame.x, Math.min(frame.x + frame.width, point.x)),
    y: Math.max(frame.y, Math.min(frame.y + frame.height, point.y)),
  };
}

/** The places (indexes into `rects`) the rectangle touches, in the order drawn. */
export function hitsIn(rects: readonly Rect[], marquee: Rect): number[] {
  const hits: number[] = [];
  for (const [index, rect] of rects.entries()) if (touches(rect, marquee)) hits.push(index);
  return hits;
}

/**
 * The selection while a drag touches `hits`, from the selection it started
 * with (`base`): replaced by them, added to, or toggled against (an item
 * that was selected and is touched goes out; it comes back when the
 * rectangle leaves it).
 */
export function combine(base: readonly string[], hits: readonly string[], mode: MarqueeMode): string[] {
  if (mode === "replace") return [...hits];
  const was = new Set(base);
  const touched = new Set(hits);
  const kept = mode === "add" ? base : base.filter((path) => !touched.has(path));
  return [...kept, ...hits.filter((path) => !was.has(path))];
}

const distance = (point: Point, rect: Rect): number => {
  const dx = Math.max(rect.x - point.x, 0, point.x - (rect.x + rect.width));
  const dy = Math.max(rect.y - point.y, 0, point.y - (rect.y + rect.height));
  return Math.hypot(dx, dy);
};

/** The item the rectangle took last: of those it touches, the one nearest its moving corner. Null when it touches none. */
export function lastTaken(rects: readonly Rect[], hits: readonly number[], corner: Point): number | null {
  let best: number | null = null;
  let nearest = Number.POSITIVE_INFINITY;
  for (const index of hits) {
    const rect = rects[index];
    if (!rect) continue;
    const far = distance(corner, rect);
    if (far <= nearest) {
      nearest = far;
      best = index;
    }
  }
  return best;
}

/**
 * How far the listing scrolls in one tick with the pointer at `y`, the
 * listing showing from `top` to `bottom` (all in window pixels): nothing in
 * the middle, a little once inside the `EDGE` band, faster the further past
 * the edge, never more than `MAX_STEP`. Negative is toward the top.
 */
export function scrollStep(y: number, top: number, bottom: number): number {
  const speed = (depth: number): number => Math.min(MAX_STEP, Math.max(2, Math.round(depth / 3)));
  if (y < top + EDGE) return -speed(top + EDGE - y);
  if (y > bottom - EDGE) return speed(y - (bottom - EDGE));
  return 0;
}

/** `step`, cut so the listing stays between its start and its end: `top` is how far it is scrolled, `range` how far it can be. */
export function stepWithin(step: number, top: number, range: number): number {
  return Math.max(0, Math.min(Math.max(0, range), top + step)) - top;
}
