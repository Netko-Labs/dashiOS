/** What a marquee is given (session.ts): how a view lays its items out, the part of the store it uses, its timers, and what it draws. */

import type { Rect } from "./geometry.ts";

/** How a view lays its items out, in its content's pixels (from the top left of what scrolls). */
export interface ListingModel {
  /** How tall everything that scrolls is. */
  contentHeight: number;
  /** The items, in the order drawn, and where each is. */
  paths: readonly string[];
  rects: readonly Rect[];
  /** What of each item a marquee must touch to take it (an icon view's icon and name); its whole place when absent. */
  parts?: readonly (readonly Rect[])[];
}

/** The part of the store a marquee uses. */
export interface MarqueeStore {
  getSnapshot(): { selection: readonly string[]; renaming: string | null };
  /** The selection while it moves (`last` null), and when it ends: the keyboard goes on from `last`. */
  sweep(paths: readonly string[], last: string | null): void;
  commitRename(): Promise<boolean>;
}

export interface Timers {
  every(ms: number, run: () => void): () => void;
}

export const REAL_TIMERS: Timers = {
  every: (ms, run) => {
    const timer = setInterval(run, ms);
    return () => clearInterval(timer);
  },
};

/** What the listing draws: the rectangle in the pixels of the view that hears the pointer, and whether a drag is on. */
export interface MarqueeView {
  rect: Rect | null;
  dragging: boolean;
}

export const IDLE: MarqueeView = { rect: null, dragging: false };
