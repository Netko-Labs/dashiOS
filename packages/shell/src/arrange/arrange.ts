/**
 * Arranging windows: layout.ts's geometry, applied through the compositor.
 * It sends the drag zones (again whenever the screens or the menu bar and
 * Dock change them), places each new window as the compositor asks, and
 * decides what the square, a title-bar double-click, the ⌃❖ keys, the
 * Window menu, agents, and full screen do. It remembers how each window is
 * arranged (a tile or Fill) and the frame it had before: what Back to
 * Previous Size gives back. A drag or a resize by the person ends the
 * arrangement: the compositor reports the grab, the shell decides. Full
 * screen is on top of all that: leaving it gives back the frame from before
 * (its tile, if it was tiled or filled), and a full-screen window may get a
 * Desktop of its own (`desktops`, spaces/fullscreen.ts), which also says
 * where a new window opens while one shows. A window's size is the one its
 * app was last asked to take until it has drawn it (`configuring`). One
 * arranging runs at a time, in the order asked, so a burst of keys acts as
 * the keys pressed one by one.
 */

import type { Compositor, Placing } from "../compositor.ts";
import { type Arrange, centerFrame, fitFrame, type Output, type Rect, sameOutputs, type Tile, tileFrame, usableFor } from "../layout.ts";
import {
  type ArrangeContext,
  type Arranged,
  arrowPlan,
  askFrame,
  configuredFrame,
  DragTiling,
  DWELL_MS,
  type EventOf,
  type FullscreenDesktopsHook,
  fitWindows,
  fullscreenWindow,
  placeWindow,
  zonesOf,
} from "./lib/arrange-frames.ts";
import { placedOutputs } from "./outputs.ts";
import type { Arrow } from "./tiling.ts";

export class Arranger {
  private outputs: Output[] = [];
  private opened = 0;
  private readonly arranged = new Map<number, Arranged>();
  /** The drag-to-tile zones and where each dragged window was as its drag began. */
  private readonly drags = new DragTiling();
  /** The frame each full-screen window had before: given back when it leaves. */
  private readonly beforeFullscreen = new Map<number, Rect>();
  /** The arranging under way, the next waits for. */
  private queue: Promise<unknown> = Promise.resolve();
  /** The first refresh; placing and arranging wait for it, since they need the screens. */
  private ready: Promise<void> = Promise.resolve();

  /** Runs after a window entered or left full screen (fullscreen.ts follows the bars). */
  afterFullscreen: (() => void) | null = null;
  /** Full-screen windows' own Desktops; none, and full screen stays on the Desktop it is on. */
  desktops: FullscreenDesktopsHook | null = null;
  /** A new window someone else places (a portal dialog that is a sheet: portal-host/sheets.ts); true takes it. */
  claim: ((window: Placing) => boolean) | null = null;

  constructor(private readonly compositor: Pick<Compositor, "on" | "session" | "outputs" | "windows" | "layout" | "place" | "frame" | "fullscreen">) {}

  /** Take over placing windows and send the drag zones; returns a stop function. */
  async start(): Promise<() => void> {
    // Listen before the first refresh: windows that open meanwhile are asked
    // about once, and a second asking would never come.
    const stop = this.compositor.on((event) => {
      const run = (work: Promise<unknown>) => work.catch((error) => console.error("dashi-shell: arranging:", error));
      if (event.event === "outputs-changed") run(this.serial(() => this.refresh()));
      else if (event.event === "window-placing") run(this.claim?.(event.window) ? Promise.resolve() : this.place(event.window));
      else if (event.event === "window-control") run(this.control(event.window, event.alt));
      else if (event.event === "zoom") run(this.zoom(event.window, event.on));
      else if (event.event === "fullscreen") run(this.fullscreen(event.window, event.on));
      else if (event.event === "window-grab") run(this.serial(() => this.grabbed(event)));
      else if (event.event === "window-drop") run(this.serial(() => this.dropped(event)));
      else if (event.event === "window-closed") this.closed(event.id);
    });
    this.ready = this.serial(() => this.refresh());
    try {
      await this.ready;
    } catch (error) {
      stop();
      throw error;
    }
    return stop;
  }

  private async refresh(): Promise<void> {
    const before = this.outputs;
    this.outputs = placedOutputs(await this.compositor.outputs());
    // `outputs-changed` also comes when a window enters or leaves full screen;
    // with the screens as they were, nothing needs fitting (and a window just
    // out of full screen still reports its full-screen size).
    const changed = !sameOutputs(before, this.outputs);
    const zones = zonesOf(this.outputs);
    this.drags.zones = zones.map(({ tile, frame, usable }) => ({ tile, frame, usable }));
    // Drag-to-tile is the compositor's to offer; without it, windows still fit their screens.
    await this.compositor
      .layout({ zones: zones.map(({ area, frame }) => ({ area, frame })), dwellMs: DWELL_MS })
      .catch((error) => console.error("dashi-shell: drag-to-tile is off:", error instanceof Error ? error.message : error));
    if (changed) await this.fitWindows();
  }

  /**
   * Windows that no longer fit their screen's usable area (a screen shrank,
   * or its scale grew) are moved in, and shrunk if they must; a tiled or
   * filled window takes its tile on the screen as it is now.
   */
  private async fitWindows(): Promise<void> {
    await fitWindows(this.context());
  }

  /** Where a new window goes, as any other (also for a claimed one that could not be placed its own way). */
  async place(window: Placing): Promise<void> {
    await this.ready;
    await placeWindow(this.context(), window, () => this.opened++);
  }

  /**
   * Ask for a frame (Fill also tells the app it is maximized; a tile says so for its
   * shadow, appearance/window-style.ts). Its size shows in `configuring` until the app has drawn it.
   * Never smaller than the app allows (`minSize`): a half too narrow for System Settings
   * takes its least width, grown away from the screen's edge.
   */
  private async frame(id: number, frame: Rect, tile: Tile | null = null): Promise<void> {
    await askFrame(this.compositor, this.outputs, id, frame, tile);
  }

  /** Run `work` after the arranging before it: one at a time, in the order asked. */
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => {});
    return next;
  }

  /** What the placing and full-screen steps (arrange-frames.ts) need of this arranger, as it is now. */
  private context(): ArrangeContext {
    return {
      compositor: this.compositor,
      desktops: this.desktops,
      outputs: this.outputs,
      arranged: this.arranged,
      beforeFullscreen: this.beforeFullscreen,
      frame: (id, frame, tile) => this.frame(id, frame, tile),
    };
  }

  /** How the shell arranged a window: a tile, Fill, or null at its own frame (the menus, agents). */
  arrangement(window: number): Tile | null {
    return this.arranged.get(window)?.tile ?? null;
  }

  /** The frame of a window on screen that can be arranged (not full screen), or null. */
  private async frameOf(id: number): Promise<Rect | null> {
    await this.ready;
    const window = (await this.compositor.windows()).find((candidate) => candidate.id === id);
    return window && window.state === "normal" && !window.fullscreen ? configuredFrame(window) : null;
  }

  /** Tile it, fill, center it at its own size, or give it its own frame back (the Window menu, ⌃❖↩ ⌃❖C ⌃❖R, agents). */
  arrange(id: number, to: Arrange): Promise<void> {
    return this.serial(() => this.arrangeNow(id, to));
  }

  private async arrangeNow(id: number, to: Arrange): Promise<void> {
    const frame = await this.frameOf(id);
    if (!frame) return;
    if (to === "restore") return this.back(id);
    const usable = usableFor(frame, this.outputs);
    if (!usable) return;
    const own = this.arranged.get(id)?.own ?? frame;
    if (to !== "center") return this.tileIn(id, to, usable, own);
    this.forget(id);
    await this.frame(id, centerFrame(own, usable));
  }

  /** ⌃❖ and an arrow: the half, the quarter, its own size, or the next screen (tiling.ts). */
  arrow(id: number, arrow: Arrow): Promise<void> {
    return this.serial(() => this.arrowNow(id, arrow));
  }

  private async arrowNow(id: number, arrow: Arrow): Promise<void> {
    const frame = await this.frameOf(id);
    if (!frame) return;
    const plan = arrowPlan(frame, this.arranged.get(id), arrow, this.outputs);
    if (plan === "back") return this.back(id);
    if (plan) await this.tileIn(id, plan.tile, plan.usable, plan.own);
  }

  /** Frame a window as `tile` in `usable`, remembering `own` to go back to. */
  private async tileIn(id: number, tile: Tile, usable: Rect, own: Rect): Promise<void> {
    this.arranged.set(id, { tile, own });
    await this.frame(id, tileFrame(tile, usable), tile);
  }

  /** Its own frame back (Back to Previous Size); nothing when it isn't arranged. */
  private async back(id: number): Promise<void> {
    const arranged = this.arranged.get(id);
    if (!arranged) return;
    this.forget(id);
    const usable = usableFor(arranged.own, this.outputs);
    await this.frame(id, usable ? fitFrame(arranged.own, usable) : arranged.own);
  }

  private forget(id: number): void {
    this.arranged.delete(id);
    this.drags.forget(id);
  }

  private closed(id: number): void {
    this.forget(id);
    this.beforeFullscreen.delete(id);
  }

  /**
   * The square, or a double-click on the title bar: Fill, or its own frame
   * back when it is filled or tiled; with ⌥, full screen. On a full-screen
   * window it leaves full screen.
   */
  control(id: number, alt: boolean): Promise<void> {
    return this.serial(async () => {
      await this.ready;
      const window = (await this.compositor.windows()).find((candidate) => candidate.id === id);
      if (!window || window.state !== "normal") return;
      if (alt || window.fullscreen) return this.fullscreenNow(id, !(window.fullscreen ?? false));
      if (this.arranged.has(id)) return this.back(id);
      await this.arrangeNow(id, "fill");
    });
  }

  /**
   * An app asked to be maximized (its own title bar's double-click), or a
   * taskbar did: as the square. Asked not to be, it only ever goes back.
   */
  zoom(id: number, on?: boolean): Promise<void> {
    return this.serial(async () => {
      if (!(await this.frameOf(id))) return;
      if (on === false || this.arranged.has(id)) return this.back(id);
      await this.arrangeNow(id, "fill");
    });
  }

  /**
   * The person began to drag or resize a window. Dragged out of a tile or
   * Fill, it gets its own size back under the pointer; either way the
   * arrangement is over.
   */
  private async grabbed(event: EventOf<"window-grab">): Promise<void> {
    const arranged = this.arranged.get(event.window);
    this.forget(event.window);
    if (event.kind === "resize") return;
    // At the size it is being asked to take, if its app has not drawn that yet (the compositor says so).
    const frame = this.drags.grabbed(event.window, event.frame, arranged?.own, event.pointer);
    if (frame) await this.frame(event.window, frame);
  }

  /** A drag let go in a drag-to-tile zone: that tile, going back to where the drag began. */
  private async dropped(event: EventOf<"window-drop">): Promise<void> {
    const drop = this.drags.dropped(event);
    if (!drop) return;
    const frame = await this.frameOf(event.window);
    if (frame) await this.tileIn(event.window, drop.tile, drop.usable, drop.from ?? frame);
  }

  /**
   * Full screen: the window covers its whole screen, over the menu bar and
   * Dock, and leaving gives the frame back (⌥ and the square, ⌃❖F, the View
   * menu, an app's own F11 or video button). Leaving gives back the frame it
   * had before, or its tile on that screen if it was tiled or filled. The
   * compositor picks the screen the window is mostly on.
   */
  fullscreen(id: number, on: boolean): Promise<void> {
    return this.serial(() => this.fullscreenNow(id, on));
  }

  private async fullscreenNow(id: number, on: boolean): Promise<void> {
    await this.ready;
    const changed = await fullscreenWindow(this.context(), id, on);
    if (changed) this.afterFullscreen?.();
  }

  /** Enter full screen, or leave it (⌃❖F, the View menu). */
  toggleFullscreen(id: number): Promise<void> {
    return this.serial(async () => {
      await this.ready;
      const window = (await this.compositor.windows()).find((candidate) => candidate.id === id);
      if (window) await this.fullscreenNow(id, !(window.fullscreen ?? false));
    });
  }
}
