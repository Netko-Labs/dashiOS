/**
 * The keyboard's item, scrolled into view: after ↑ ↓ ← →, the page keys,
 * Home, End or a typed name, the listing scrolls just far enough to show
 * the item the keyboard is on (to its start or end when that is the first
 * or last row). The scroll view says how far it is scrolled and takes a
 * scroll (`ScrollPlace`, place.ts: D143), so this is one sum and one ask.
 * A key that repeats before the last scroll is told back goes on from where
 * that one was sent. On a host that says no scroll position nothing is
 * scrolled.
 */

import type { Rect } from "./geometry.ts";
import type { ScrollPlace } from "./place.ts";
import type { ListingModel } from "./types.ts";

/** An item this near what scrolls' start or end takes the listing all the way there (the grid's padding, a list's room under its last row). */
const NEAR_END = 12;

/**
 * How far to scroll down (negative: up) so `item` shows whole: `top` is how
 * far the listing is scrolled, `view` how tall it shows, `content` how tall
 * everything is. Nothing when it shows already, or is taller than the view
 * and fills it.
 */
export function revealStep(item: Rect, top: number, view: number, content: number): number {
  const end = item.y + item.height;
  if (item.y < top) return (item.y <= NEAR_END ? 0 : item.y) - top;
  if (end > top + view) return (content - end <= NEAR_END ? content : end) - view - top;
  return 0;
}

/** Show `path` in the listing `model` lays out, scrolled as `place` says. */
export function reveal(path: string, model: ListingModel | null, place: ScrollPlace): void {
  const rect = model?.rects[model.paths.indexOf(path)];
  const view = place.viewport?.height;
  if (!model || !rect || view === undefined) return;
  const step = revealStep(rect, place.top, view, model.contentHeight);
  if (step !== 0) place.scrollTo(place.top + step, place.range(model.contentHeight));
}
