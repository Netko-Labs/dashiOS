/**
 * Where a listing's content stands in its window: the scroll view's place
 * (its `onLayout`), how far its content has gone under it (its `onScroll`,
 * whoever scrolled it: a wheel, a touchpad, this), and its handle to scroll
 * it (its `ref`, mirin's `ViewHandle`). The content's top left is then the
 * view's less the offset, which is what a marquee draws against and what
 * the keyboard's item is shown by (decisions.md D143, which replaced the
 * asking of D100 and D113).
 *
 * A scroll asked for is told back a frame later. Until then `top` is where
 * it was sent, so a timer that scrolls again, or a key that repeats, goes on
 * from there and not from where the content still stands.
 */

import type { Bounds, ScrollInfo, ViewHandle } from "@mirinjs/metal";
import type { Point, Rect } from "./geometry.ts";

/** A scroll asked for and never told back (it was where the view already stood, or beyond its range) is forgotten after this long. */
const ASKED_MS = 250;

export class ScrollPlace {
  /** The scroll view, in window pixels; null until it is laid out. */
  viewport: Rect | null = null;
  /** Called when the content moved or the view did. */
  moved: (() => void) | null = null;
  private handle: ViewHandle | null = null;
  private offset: Point = { x: 0, y: 0 };
  /** How far the view says it can scroll; null until it has said. */
  private most: number | null = null;
  private asked: { y: number; at: number } | null = null;

  constructor(private readonly now: () => number = () => performance.now()) {}

  /** The scroll view's `ref`: another view (icons to list, a folder that was empty) starts at its start and says nothing. */
  attach = (handle: ViewHandle | null): void => {
    if (handle === this.handle) return;
    this.handle = handle;
    this.offset = { x: 0, y: 0 };
    this.most = null;
    this.asked = null;
    if (!handle) this.viewport = null;
  };

  /** The scroll view's `onLayout`. */
  layout = (bounds: Bounds): void => {
    this.viewport = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
    this.moved?.();
  };

  /** The scroll view's `onScroll`. */
  scroll = (info: ScrollInfo): void => {
    this.offset = { x: info.contentOffset.x, y: info.contentOffset.y };
    this.most = Math.max(0, info.contentSize.height - info.layoutMeasurement.height);
    this.asked = null;
    this.moved?.();
  };

  /** What goes on the scroll view. */
  readonly props = { ref: this.attach, onLayout: this.layout, onScroll: this.scroll };

  /** The content's top left in window pixels, as it is painted; null before the view is laid out. */
  origin(): Point | null {
    return this.viewport && { x: this.viewport.x - this.offset.x, y: this.viewport.y - this.offset.y };
  }

  /** How far down the content is scrolled, counting a scroll asked for and not told back yet. */
  get top(): number {
    if (this.asked && this.now() - this.asked.at > ASKED_MS) this.asked = null;
    return this.asked?.y ?? this.offset.y;
  }

  /** How far it can scroll: what the view said, else what `contentHeight` (the view's own measure) gives. */
  range(contentHeight: number): number {
    return this.most ?? Math.max(0, contentHeight - (this.viewport?.height ?? 0));
  }

  /** Scroll to `y`, kept in `range`; nothing when it is there, or is being sent there. */
  scrollTo(y: number, range: number): void {
    const to = Math.max(0, Math.min(range, y));
    if (to === this.top || !this.handle) return;
    this.asked = { y: to, at: this.now() };
    this.handle.scrollTo({ y: to });
  }
}
