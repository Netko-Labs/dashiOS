/**
 * Arranging windows: layout.ts's geometry, applied through the compositor.
 * It sends the drag zones (again whenever the screens or the menu bar and
 * Dock change them), places each new window as the compositor asks, and
 * decides what the square, a title-bar double-click, the ⌃❖ keys, the
 * Window menu, agents, and full screen do. It remembers how each window is
 * arranged (a tile or Fill) and the frame it had before: what Back to
 * Previous Size gives back. A drag or a resize by the person ends the
 * arrangement: the compositor reports the grab, the shell decides. Where a
 * new window opens, and an app's memory of its last window, are placing.ts
 * and remember.ts; a screen that goes or comes back, screens-gone.ts. Full
 * screen is on top of all that: leaving it gives back the frame from before
 * (its tile, if it was tiled or filled), and a full-screen window may get a
 * Desktop of its own (`desktops`, spaces/fullscreen.ts), which also says
 * where a new window opens while one shows. A window's size is the one its
 * app was last asked to take until it has drawn it (`configuring`). One
 * arranging runs at a time, in the order asked, so a burst of keys acts as
 * the keys pressed one by one.
 */

import type { Compositor, Placing } from "../compositor/index.ts";
import { type Arrange, centerFrame, fitFrame, type Output, type Rect, sameOutputs, type Tile, tileFrame, usableFor } from "../layout.ts";
import {
  type Arranged,
  arrowPlan,
  askFrame,
  configuredFrame,
  type EventOf,
  type FullscreenDesktopsHook,
  fullscreenWindow,
  screenPlan,
} from "./lib/arrange-frames.ts";
import { DragTiling } from "./lib/drags.ts";
import { MemoryFile } from "./lib/memory-file.ts";
import { placeWindow } from "./lib/placing.ts";
import { Remembering } from "./lib/remember.ts";
import { type Displaced, type ScreensContext, screensChanged } from "./lib/screens-gone.ts";
import { placedOutputs } from "./outputs.ts";
import type { Arrow } from "./tiling.ts";

export class Arranger {
  private outputs: Output[] = [];
  private opened = 0;
  private readonly arranged = new Map<number, Arranged>();
  /** The drag-to-tile zones and where each dragged window was as its drag began. */
  private readonly drags = new DragTiling({
    arranged: this.arranged,
    forget: (id) => this.forget(id),
    frame: (id, frame) => this.frame(id, frame),
    frameOf: (id) => this.frameOf(id),
    tileIn: (id, tile, usable, own) => this.tileIn(id, tile, usable, own),
  });
  /** The frame each full-screen window had before: given back when it leaves. */
  private readonly beforeFullscreen = new Map<number, Rect>();
  /** Windows moved off a screen that went, until it comes back (screens-gone.ts). */
  private readonly displaced = new Map<number, Displaced>();
  /** Each app's last window: what a window leaves as it closes, and what a first window opens by. */
  private readonly remembering: Remembering;
  /** The arranging under way, the next waits for. */
  private queue: Promise<unknown> = Promise.resolve();
  /** The first refresh; placing and arranging wait for it, since they need the screens. */
  private ready: Promise<void> = Promise.resolve();

  /** Runs after a window entered or left full screen (fullscreen.ts follows the bars). */
  afterFullscreen: (() => void) | null = null;
  /** Full-screen windows' own Desktops; none, and full screen stays on the Desktop it is on. */
  desktops: FullscreenDesktopsHook | null = null;
  /** The Space an agent's window opens on, when it works on another Desktop (agents/desktop/elsewhere.ts); null for the usual one. */
  elsewhere: ((window: Placing) => Promise<number | null>) | null = null;
  /** A new window someone else places (a portal dialog that is a sheet: portal-host/sheets.ts); true takes it. */
  claim: ((window: Placing) => boolean) | null = null;

  constructor(
    private readonly compositor: Pick<Compositor, "on" | "session" | "outputs" | "windows" | "layout" | "place" | "frame" | "fullscreen">,
    /** Where apps' last windows are kept: "on" for the person's file, a file of its own (tests), or none. */
    memory: MemoryFile | "on" | null = null,
  ) {
    this.remembering = new Remembering(memory === "on" ? new MemoryFile() : memory);
  }

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
      else if (event.event === "window-grab") run(this.serial(() => this.drags.grab(event)));
      else if (event.event === "window-drop") run(this.serial(() => this.drags.drop(event)));
      else if (event.event === "window-closed") this.closed(event);
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
    await this.drags.send(this.compositor, this.outputs);
    if (!changed) return;
    // Every window follows its screen, on every Desktop (screens-gone.ts): windows of a
    // screen that went move to one left, and back when it returns; the others go where
    // their screen went, inside what it leaves free, a tile taking its tile there.
    await screensChanged(this.context(), before);
  }

  /** Where a new window goes, as any other (also for a claimed one that could not be placed its own way). */
  async place(window: Placing): Promise<void> {
    await this.ready;
    const placed = await placeWindow(this.context(), window, this.remembering.recall(window), () => this.opened++);
    this.remembering.placed(window);
    if (!placed?.recalled) return;
    // Back as it was: tiled or filled (its own frame, for Back, its size centered), or full screen.
    if (placed.tile) this.arranged.set(window.id, { tile: placed.tile, own: centerFrame(window, usableFor(placed.frame, this.outputs) ?? placed.frame) });
    if (placed.fullscreen) await this.fullscreen(window.id, true, true);
  }

  /** Ask for a frame, a tile's or Fill's said so, never smaller than the app allows (arrange-frames.ts `askFrame`). */
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
  private context(): ScreensContext {
    return {
      displaced: this.displaced,
      compositor: this.compositor,
      desktops: this.desktops,
      elsewhere: this.elsewhere,
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

  /** To another screen, by its name (the Window menu): the same place there, the same tile if it is one. */
  toScreen(id: number, name: string): Promise<void> {
    return this.serial(async () => {
      const frame = await this.frameOf(id);
      const plan = frame && screenPlan(frame, this.arranged.get(id), name, this.outputs);
      if (!plan) return;
      if (plan.tile) return this.tileIn(id, plan.tile, plan.usable, plan.own);
      this.forget(id);
      await this.frame(id, plan.frame);
    });
  }

  /** Frame a window as `tile` in `usable`, remembering `own` to go back to. */
  private async tileIn(id: number, tile: Tile, usable: Rect, own: Rect): Promise<void> {
    this.displaced.delete(id);
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

  /** Its arrangement is over: moved, resized or arranged anew, it no longer goes back to a screen that returns either. */
  private forget(id: number): void {
    this.arranged.delete(id);
    this.drags.forget(id);
    this.displaced.delete(id);
  }

  private closed(event: EventOf<"window-closed">): void {
    this.remembering.closed(event.id, event, this.arranged.get(event.id)?.tile ?? null, this.outputs, this.displaced.get(event.id));
    this.forget(event.id);
    this.beforeFullscreen.delete(event.id);
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
      if (alt || window.fullscreen) return this.fullscreenNow(id, !(window.fullscreen ?? false), true);
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
   * Full screen: the window covers its whole screen, over the menu bar and
   * Dock, and leaving gives the frame back (⌥ and the square, ⌃❖F, the View
   * menu, an app's own F11 or video button). Leaving gives back the frame it
   * had before, or its tile on that screen if it was tiled or filled. The
   * compositor picks the screen the window is mostly on.
   */
  fullscreen(id: number, on: boolean, byPerson = false): Promise<void> {
    return this.serial(() => this.fullscreenNow(id, on, byPerson));
  }

  /** `byPerson`: the person asked (not the app), so it comes back full screen if it closes so (remember.ts). */
  private async fullscreenNow(id: number, on: boolean, byPerson = false): Promise<void> {
    await this.ready;
    const changed = await fullscreenWindow(this.context(), id, on);
    if (changed && (byPerson || !on)) this.remembering.fullscreen(id, on);
    if (changed) this.afterFullscreen?.();
  }

  /** Enter full screen, or leave it (⌃❖F, the View menu). */
  toggleFullscreen(id: number): Promise<void> {
    return this.serial(async () => {
      await this.ready;
      const window = (await this.compositor.windows()).find((candidate) => candidate.id === id);
      if (window) await this.fullscreenNow(id, !(window.fullscreen ?? false), true);
    });
  }
}
