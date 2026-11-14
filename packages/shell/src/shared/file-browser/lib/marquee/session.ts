/**
 * A marquee in the listing: a press on empty space that moves past a small
 * threshold draws a rectangle to the pointer, and every item it touches is
 * selected as it moves (geometry.ts). The rectangle is anchored to what
 * scrolls, not to the window: at the top or bottom edge the listing scrolls
 * under it and it grows. Letting go keeps the selection; Esc puts back the
 * one from before.
 *
 * Metal gives a press, its moves and its release (`onPointer`), but neither
 * where a scroll view stands nor the keys held during a drag (D99). So the
 * session asks the window where an item is painted (`WindowSurface.bounds`)
 * to learn where the content sits: when the drag starts, and then every
 * `POLL_MS` while it is not scrolling the listing itself, since a wheel
 * moves the items with no word to the app (the scroll view takes the turn).
 * Its own scrolling it counts. The keys are those of the click the release makes
 * (`press`), unless the host says them with the pointer.
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
import { inView, itemAt, locate } from "./locate.ts";
import { IDLE, type ListingModel, type MarqueeStore, type MarqueeView, REAL_TIMERS, type Timers } from "./types.ts";

/** How often a drag asks where the content stands, while it is not scrolling it itself. */
export const POLL_MS = 150;

type Phase = "idle" | "armed" | "placing" | "active";

export class Marquee {
  /** The window's surface and the view's layout: set by the listing as it draws. */
  surface: WindowSurface | null = null;
  model: ListingModel | null = null;

  private phase: Phase = "idle";
  /** This press became a drag: the click its release makes is not a click. */
  private dragged = false;
  private released = false;
  private down: Point = { x: 0, y: 0 };
  private pointer: Point = { x: 0, y: 0 };
  /** The view that hears the pointer, the scroll view, and the content's top left: all in window pixels. */
  private frame: Bounds | null = null;
  private viewport: Rect = { x: 0, y: 0, width: 0, height: 0 };
  private origin: Point = { x: 0, y: 0 };
  /** Where the press was, in the content. */
  private anchor: Point = { x: 0, y: 0 };
  private base: readonly string[] = [];
  private mode: MarqueeMode = "replace";
  private taken: { paths: string[]; last: string | null } | null = null;
  private shown = "";
  /** Counts the drags, so an answer for an older one is dropped. */
  private run = 0;
  /** Every pixel this session scrolled the listing. */
  private scrolled = 0;
  private stopTicking: (() => void) | null = null;
  private stopPolling: (() => void) | null = null;
  /** The listing was just scrolled from here: what is painted may not show it yet, so one poll is let go. */
  private justScrolled = false;
  private view: MarqueeView = IDLE;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly store: MarqueeStore,
    private readonly timers: Timers = REAL_TIMERS,
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): MarqueeView => this.view;

  /** The pointer on the listing's own space (a press on an item never gets here: the item takes it). */
  pointerEvent = (event: PointerInfo & { modifiers?: Modifiers }): void => {
    const at = { x: event.x, y: event.y };
    if (event.bounds) this.frame = event.bounds;
    if (event.phase === "down") {
      this.stop();
      this.dragged = false;
      this.taken = null;
      this.down = at;
      this.pointer = at;
      this.mode = event.modifiers ? modeOf(event.modifiers) : "replace";
      this.phase = this.surface && this.model ? "armed" : "idle";
      return;
    }
    this.pointer = at;
    if (event.phase === "move") {
      if (this.phase === "armed" && isDrag(this.down, at)) this.begin();
      else if (this.phase === "active") this.update();
    } else if (this.phase === "active") {
      // The release may be somewhere the last move was not.
      this.update();
      this.finish();
    } else if (this.phase === "placing") this.released = true;
    else this.phase = "idle";
  };

  /** The pointer on an item (a tile, a row's icon and name): the press is the item's, and whatever drag came before is over. */
  itemPointer = (event: PointerInfo): void => {
    if (event.phase !== "down") return;
    this.dragged = false;
    this.taken = null;
  };

  /**
   * The click a release makes, on the empty space or on a row. True when it
   * ended a drag: it is then not a click, and its keys say what the drag
   * does (plain replaces, ⇧ adds, ❖ toggles).
   */
  press(held: Modifiers): boolean {
    if (!this.dragged) return false;
    this.dragged = false;
    this.mode = modeOf(held);
    if (this.phase === "active") this.update();
    else if (this.taken) this.store.sweep(combine(this.base, this.taken.paths, this.mode), this.taken.last);
    return true;
  }

  /**
   * The item the last press on the listing's own space was on, where the
   * items leave their clicks to the listing (the list's rows): null for
   * empty space, and at once where items take their own clicks.
   */
  pressed(): Promise<string | null> | null {
    const { model, surface } = this;
    return model?.clicksToListing && surface ? itemAt(surface, model, this.down) : null;
  }

  /** Esc: the drag ends and the selection from before comes back. True when there was one. */
  cancel(): boolean {
    if (this.phase !== "placing" && this.phase !== "active") return false;
    this.stop();
    this.taken = null;
    this.store.sweep(this.base, null);
    return true;
  }

  private begin(): void {
    this.phase = "placing";
    this.dragged = true;
    this.released = false;
    const state = this.store.getSnapshot();
    this.base = [...state.selection];
    if (state.renaming !== null) void this.store.commitRename();
    this.shown = "";
    this.place();
  }

  /** Ask where the scroll view and the items are painted, and stand the content there. */
  private place(): void {
    const { model, surface, run, scrolled } = this;
    if (!model || !surface) return;
    void locate(surface, model).then((placed) => {
      if (run !== this.run || (this.phase !== "placing" && this.phase !== "active")) return;
      if (!placed) {
        // Nothing to go by: a drag that has not started never does; one under way keeps its count.
        if (this.phase === "placing") this.stop();
        return;
      }
      this.viewport = placed.viewport;
      // What was scrolled since the question was asked is not in its answer.
      this.origin = { x: placed.origin.x, y: placed.origin.y - (this.scrolled - scrolled) };
      if (this.phase === "placing") this.start();
      else this.update();
    });
  }

  private start(): void {
    const { viewport, down } = this;
    // A press outside what scrolls (a list's header) draws nothing.
    if (!inView(down, viewport)) {
      this.stop();
      this.dragged = false;
      return;
    }
    this.anchor = { x: down.x - this.origin.x, y: down.y - this.origin.y };
    this.phase = "active";
    this.stopPolling = this.timers.every(POLL_MS, this.poll);
    this.update();
    if (this.released) this.finish();
  }

  /** The rectangle from the anchor to the pointer: what it touches is selected, it is drawn, and at an edge the listing scrolls. */
  private update(): void {
    const { model, origin, viewport } = this;
    if (!model) return;
    const at = clampTo(this.pointer, viewport);
    const corner = { x: at.x - origin.x, y: at.y - origin.y };
    const marquee = rectBetween(this.anchor, corner);
    const hits = hitsIn(model.rects, marquee);
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
    const viewport = this.viewport;
    if (!model) return 0;
    const wanted = scrollStep(this.pointer.y, viewport.y, viewport.y + viewport.height);
    return stepWithin(wanted, viewport.y - this.origin.y, model.contentHeight - viewport.height);
  }

  private tick = (): void => {
    const step = this.step();
    if (step === 0 || !this.model || this.phase !== "active") {
      this.rest();
      return;
    }
    this.surface?.scrollBy(this.model.scrollID, step);
    this.scrolled += step;
    this.origin = { x: this.origin.x, y: this.origin.y - step };
    this.update();
  };

  /** The scrolling stops; the next poll but one says where the content came to rest. */
  private rest(): void {
    if (!this.stopTicking) return;
    this.stopTicking();
    this.stopTicking = null;
    this.justScrolled = true;
  }

  /** The listing may have moved by itself (a wheel): ask, unless this drag is scrolling it. */
  private poll = (): void => {
    if (this.phase !== "active" || this.stopTicking) return;
    if (this.justScrolled) this.justScrolled = false;
    else this.place();
  };

  private finish(): void {
    const taken = this.taken;
    this.stop();
    if (taken) this.store.sweep(combine(this.base, taken.paths, this.mode), taken.last);
  }

  /** The drag is over, however it ended: no timers, no rectangle, and answers still on their way are dropped. */
  private stop(): void {
    this.run++;
    this.phase = "idle";
    this.stopTicking?.();
    this.stopTicking = null;
    this.stopPolling?.();
    this.stopPolling = null;
    this.justScrolled = false;
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
