/**
 * The keyboard's item, scrolled into view: after ↑ ↓ ← →, the page keys,
 * Home, End or a typed name, the listing scrolls just far enough to show
 * the item the keyboard is on (to its start or end when that is the first
 * or last row). Metal says nothing of where a scroll view stands, so this
 * asks the window, as a marquee does (D100, locate.ts), and scrolls through
 * it. What is painted may not show a scroll yet, so one item is shown at a
 * time, the next waits a few looks for the last scroll to be seen, and one
 * still unseen is counted; keys that repeat faster end on the last one's item.
 */

import type { WindowSurface } from "../../../metal/index.ts";
import type { Rect } from "./geometry.ts";
import { locate } from "./locate.ts";
import type { ListingModel } from "./types.ts";

/** An item this near what scrolls' start or end takes the listing all the way there (the grid's padding, a list's room under its last row). */
const NEAR_END = 12;
/** How many times the window is asked whether a scroll shows yet. */
const LOOKS = 6;

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

type Listing = () => { surface: WindowSurface | null; model: ListingModel | null };

export class Reveal {
  private wanted: string | null = null;
  private busy = false;
  /** A scroll asked for that no answer has shown yet: where the content stood then, and how far it was sent. */
  private unseen: { from: number; step: number } | null = null;

  /** Show `path`; `listing` says the window and the layout as they are when they are needed (a key may change both). */
  show(path: string, listing: Listing): void {
    this.wanted = path;
    if (this.busy) return;
    this.busy = true;
    void this.run(listing).finally(() => {
      this.busy = false;
    });
  }

  private async run(listing: Listing): Promise<void> {
    while (this.wanted !== null) {
      const path = this.wanted;
      this.wanted = null;
      const { surface, model } = listing();
      const rect = model?.rects[model.paths.indexOf(path)];
      if (!surface || !model || !rect) continue;
      const placed = await locate(surface, model);
      if (!placed) continue;
      const view = placed.viewport.height;
      let top = placed.viewport.y - placed.origin.y;
      // A scroll still not painted is counted, so it is not asked for twice.
      if (this.unseen?.from === placed.origin.y) top = Math.max(0, Math.min(Math.max(0, model.contentHeight - view), top + this.unseen.step));
      else this.unseen = null;
      const step = revealStep(rect, top, view, model.contentHeight);
      if (step === 0) continue;
      surface.scrollBy(model.scrollID, step);
      this.unseen = { from: placed.origin.y, step: top + step - (placed.viewport.y - placed.origin.y) };
      // Wait until the scroll shows, a few looks at most.
      for (let look = 0; look < LOOKS; look++) {
        const now = await locate(surface, model);
        if (!now || now.origin.y === placed.origin.y) continue;
        this.unseen = null;
        break;
      }
    }
  }
}

const reveals = new WeakMap<object, Reveal>();

/** The one revealer of a browser (its store). */
export function revealOf(store: object): Reveal {
  let reveal = reveals.get(store);
  if (!reveal) {
    reveal = new Reveal();
    reveals.set(store, reveal);
  }
  return reveal;
}
