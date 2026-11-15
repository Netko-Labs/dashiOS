/**
 * A marquee in the listing: a press on empty space that moves past a small
 * threshold draws a rectangle to the pointer, and every item it touches is
 * selected as it moves (geometry.ts). The rectangle is anchored to what
 * scrolls, not to the window: at the top or bottom edge the listing scrolls
 * under it and it grows. Letting go keeps it; Esc puts back the one before.
 *
 * Metal gives a press, its moves and its release (`onPointer`), each with
 * the keys held (D104), and says where the scroll view is and how far its
 * content has gone under it (`ScrollPlace`, place.ts: D134). The rectangle
 * is worked out again whenever either moves: a wheel or a touchpad during
 * the drag, and the drag's own scrolling at an edge, which it asks of the
 * view and hears back like any other. On a host that says no scroll
 * position nothing is dragged out. The keys say the drag's rule from the press on:
 * plain replaces, ⇧ adds, ❖ toggles, and one pressed or let go mid-drag
 * changes it there and then. An older host says no keys with the pointer:
 * the rule is then the keys of the click the release makes (`press`).
 */

import type { Bounds, Modifiers, PointerInfo } from "@mirinjs/metal";
import type { WindowSurface } from "../../../metal/index.ts";
import {
  clampTo,
  clip,
  combine,
  hitsIn,
  isDrag,
  lastTaken,
  type MarqueeMode,
  modeOf,
  type Point,
  type Rect,
  rectBetween,
  scrollStep,
  stepWithin,
  TICK_MS,
} from "./geometry.ts";
import { ScrollPlace } from "./place.ts";
import { IDLE, type ListingModel, type MarqueeStore, type MarqueeView, REAL_TIMERS, type Timers } from "./types.ts";

/** How long after a drag's release its click may still come (none comes from a release off the item pressed): a later one is its own. */
export const CLICK_MS = 400;

type Phase = "idle" | "armed" | "active";

/** Whether `point` (window pixels) is in the scroll view. */
function inView(point: Point, viewport: Rect): boolean {
  return point.x >= viewport.x && point.x <= viewport.x + viewport.width && point.y >= viewport.y && point.y <= viewport.y + viewport.height;
}

export class Marquee {
  /** The window's surface and the view's layout: set by the listing as it draws. */
  surface: WindowSurface | null = null;
  model: ListingModel | null = null;
  /** Where the scroll view is and how far it is scrolled: the view's scroll view feeds it (`place.props`). */
  readonly place: ScrollPlace;

  private phase: Phase = "idle";
  /** This press became a drag: the click its release makes is not a click. */
  private dragged = false;
  private stopWaiting: (() => void) | null = null;
  /** The host says the keys with the pointer; an older one leaves them to the click. */
  private keyed = false;
  private down: Point = { x: 0, y: 0 };
  private pointer: Point = { x: 0, y: 0 };
  /** The view that hears the pointer, in window pixels. */
  private frame: Bounds | null = null;
  /** Where the press was, in the content. */
  private anchor: Point = { x: 0, y: 0 };
  private base: readonly string[] = [];
  private mode: MarqueeMode = "replace";
  private taken: { paths: string[]; last: string | null } | null = null;
  private shown = "";
  private stopTicking: (() => void) | null = null;
  private view: MarqueeView = IDLE;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly store: MarqueeStore,
    private readonly timers: Timers = REAL_TIMERS,
    place: ScrollPlace = new ScrollPlace(),
  ) {
    this.place = place;
    // The content moved under the drag (a wheel, a touchpad, its own scrolling), or the view did: the rectangle follows.
    place.moved = () => {
      if (this.phase === "active") this.update();
    };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): MarqueeView => this.view;

  /** The pointer on the listing's own space (a press on an item never gets here: the item takes it). */
  pointerEvent = (event: PointerInfo): void => {
    const at = { x: event.x, y: event.y };
    if (event.bounds) this.frame = event.bounds;
    if (event.phase === "down") {
      this.stop();
      this.forget();
      this.taken = null;
      this.down = at;
      this.pointer = at;
      this.keyed = event.modifiers !== undefined;
      this.mode = event.modifiers ? modeOf(event.modifiers) : "replace";
      this.phase = this.surface?.scrolls() && this.model ? "armed" : "idle";
      return;
    }
    this.pointer = at;
    // The keys as they are now: one pressed or let go mid-drag comes as a move where the pointer is.
    if (event.modifiers) this.mode = modeOf(event.modifiers);
    if (event.phase === "up" && this.dragged) this.stopWaiting = this.timers.every(CLICK_MS, this.forget);
    if (event.phase === "move") {
      if (this.phase === "armed" && isDrag(this.down, at)) this.begin();
      else if (this.phase === "active") this.update();
    } else if (this.phase === "active") {
      // The release may be somewhere the last move was not.
      this.update();
      this.finish();
    } else this.phase = "idle";
  };

  /** The pointer on an item (a tile, a row's icon and name): the press is the item's, and whatever drag came before is over. */
  itemPointer = (event: PointerInfo): void => {
    if (event.phase !== "down") return;
    this.forget();
    this.taken = null;
  };

  /**
   * The click a release makes, on the empty space or on a row. True when it
   * ended a drag: it is then not a click. From a host that says no keys with
   * the pointer, the click's keys say what the drag does.
   */
  press(held: Modifiers): boolean {
    if (!this.dragged) return false;
    this.forget();
    if (this.keyed) return true;
    this.mode = modeOf(held);
    if (this.phase === "active") this.update();
    else if (this.taken) this.store.sweep(combine(this.base, this.taken.paths, this.mode), this.taken.last);
    return true;
  }

  /** The press is no longer a drag whose click is owed: the click came, or will not. */
  private forget = (): void => {
    this.dragged = false;
    this.stopWaiting?.();
    this.stopWaiting = null;
  };

  /** Esc: the drag ends and the selection from before comes back. True when there was one. */
  cancel(): boolean {
    if (this.phase !== "active") return false;
    this.stop();
    this.taken = null;
    this.store.sweep(this.base, null);
    return true;
  }

  private begin(): void {
    const { viewport } = this.place;
    const origin = this.place.origin();
    // Not laid out yet, or a press outside what scrolls (a list's header): nothing is drawn.
    if (!viewport || !origin || !inView(this.down, viewport)) {
      this.phase = "idle";
      return;
    }
    this.dragged = true;
    const state = this.store.getSnapshot();
    this.base = [...state.selection];
    if (state.renaming !== null) void this.store.commitRename();
    this.shown = "";
    this.anchor = { x: this.down.x - origin.x, y: this.down.y - origin.y };
    this.phase = "active";
    this.update();
  }

  /** The rectangle from the anchor to the pointer: what it touches is selected, it is drawn, and at an edge the listing scrolls. */
  private update(): void {
    const { model } = this;
    const { viewport } = this.place;
    const origin = this.place.origin();
    if (!model || !viewport || !origin) return;
    const at = clampTo(this.pointer, viewport);
    const corner = { x: at.x - origin.x, y: at.y - origin.y };
    const marquee = rectBetween(this.anchor, corner);
    const hits = hitsIn(model.parts ?? model.rects, marquee);
    const paths = hits.flatMap((index) => model.paths[index] ?? []);
    const last = lastTaken(model.rects, hits, corner);
    this.taken = { paths, last: last === null ? null : (model.paths[last] ?? null) };
    const selection = combine(this.base, paths, this.mode);
    const key = selection.join("\n");
    if (key !== this.shown) {
      this.shown = key;
      this.store.sweep(selection, null);
    }
    const drawn = clip({ ...marquee, x: marquee.x + origin.x, y: marquee.y + origin.y }, viewport);
    const frame = this.frame ?? { x: 0, y: 0 };
    this.show({ rect: drawn && { ...drawn, x: drawn.x - frame.x, y: drawn.y - frame.y }, dragging: true });
    if (this.step() === 0) this.rest();
    else this.stopTicking ??= this.timers.every(TICK_MS, this.tick);
  }

  /** How far the listing would scroll now: nothing away from the edges, or at the end of its range. */
  private step(): number {
    const model = this.model;
    const viewport = this.place.viewport;
    if (!model || !viewport) return 0;
    const wanted = scrollStep(this.pointer.y, viewport.y, viewport.y + viewport.height);
    return stepWithin(wanted, this.place.top, this.place.range(model.contentHeight));
  }

  /** At an edge: the view is asked to scroll, and the rectangle follows when it says it has (`place.moved`). */
  private tick = (): void => {
    const step = this.step();
    if (step === 0 || !this.model || this.phase !== "active") {
      this.rest();
      return;
    }
    this.place.scrollTo(this.place.top + step, this.place.range(this.model.contentHeight));
  };

  private rest(): void {
    this.stopTicking?.();
    this.stopTicking = null;
  }

  private finish(): void {
    const taken = this.taken;
    this.stop();
    if (taken) this.store.sweep(combine(this.base, taken.paths, this.mode), taken.last);
  }

  /** The drag is over, however it ended: no timer, no rectangle. */
  private stop(): void {
    this.phase = "idle";
    this.rest();
    this.show(IDLE);
  }

  private show(view: MarqueeView): void {
    const { rect } = this.view;
    const same =
      view.dragging === this.view.dragging &&
      (view.rect === rect ||
        (view.rect !== null &&
          rect !== null &&
          view.rect.x === rect.x &&
          view.rect.y === rect.y &&
          view.rect.width === rect.width &&
          view.rect.height === rect.height));
    if (same) return;
    this.view = view;
    for (const listener of this.listeners) listener();
  }
}
