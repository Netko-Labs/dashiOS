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
 * (its tile, if it was tiled or filled). A window's size is the one its
 * app was last asked to take until it has drawn it (`configuring`). One
 * arranging runs at a time, in the order asked, so a burst of keys acts as
 * the keys pressed one by one.
 */

import { type Compositor, type CompositorEvent, type CompositorWindow, type Placing, parseFrame, parsePointer } from "./compositor.ts";
import {
  type Arrange,
  carryFrame,
  centerFrame,
  dragZones,
  fitFrame,
  frameUnderPointer,
  type Output,
  placeNew,
  type Rect,
  sameOutputs,
  sameRect,
  screenFor,
  type Tile,
  tileFrame,
  usableFor,
} from "./layout.ts";
import { type Arrow, arrowStep, screenToward } from "./tiling.ts";

/** How long the pointer rests in a drag zone before its preview shows. */
const DWELL_MS = 150;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

export function parseOutputs(value: unknown): Output[] {
  const outputs = isRecord(value) && Array.isArray(value.outputs) ? value.outputs : [];
  return outputs.flatMap((output) => {
    if (!isRecord(output)) return [];
    const frame = parseFrame(output.frame);
    const usable = parseFrame(output.usable);
    if (!frame || !usable) return [];
    return [{ name: String(output.name ?? ""), frame, usable, scale: Number(output.scale) || 1 }];
  });
}

/** A window the shell arranged: how, and the frame it had before (what Back gives back). */
interface Arranged {
  tile: Tile;
  own: Rect;
}

type EventOf<Name extends CompositorEvent["event"]> = Extract<CompositorEvent, { event: Name }>;

export class Arranger {
  private outputs: Output[] = [];
  private opened = 0;
  private readonly arranged = new Map<number, Arranged>();
  /** Where each dragged window was as its drag began: its own frame, if the drag ends in a tile. */
  private readonly dragFrom = new Map<number, Rect>();
  /** The frame each full-screen window had before: given back when it leaves. */
  private readonly beforeFullscreen = new Map<number, Rect>();
  /** The arranging under way, the next waits for. */
  private queue: Promise<unknown> = Promise.resolve();
  /** The drag-to-tile zones last sent, in order: which tile each is, on which screen. */
  private zones: Array<{ tile: Tile; frame: Rect; usable: Rect }> = [];
  /** The first refresh; placing and arranging wait for it, since they need the screens. */
  private ready: Promise<void> = Promise.resolve();

  /** Runs after a window entered or left full screen (fullscreen.ts follows the bars). */
  afterFullscreen: (() => void) | null = null;
  /** A new window someone else places (a portal dialog that is a sheet: portal-host/sheets.ts); true takes it. */
  claim: ((window: Placing) => boolean) | null = null;

  constructor(private readonly compositor: Compositor) {}

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

  /**
   * The usable area of the screen a new window opens on: the screen with the
   * pointer (`session` says where it is), else the screen of the window that
   * has the keyboard; with one screen, or nothing known, the first.
   */
  private async usableForNew(placing: number): Promise<Rect | null> {
    const first = this.outputs[0]?.usable ?? null;
    if (this.outputs.length < 2) return first;
    const pointer = parsePointer(await this.compositor.request("session").catch(() => null));
    // A zero-size frame at the pointer: the screen holding that point.
    if (pointer) return usableFor({ ...pointer, width: 0, height: 0 }, this.outputs);
    try {
      const windows = await this.compositor.windows();
      const target = windows.find((candidate) => candidate.focused && candidate.id !== placing && candidate.state === "normal");
      return target?.frame ? usableFor(target.frame, this.outputs) : first;
    } catch {
      // The session is locked: the first screen is still a place.
      return first;
    }
  }

  private async refresh(): Promise<void> {
    const before = this.outputs;
    this.outputs = parseOutputs(await this.compositor.request("outputs"));
    // `outputs-changed` also comes when a window enters or leaves full screen;
    // with the screens as they were, nothing needs fitting (and a window just
    // out of full screen still reports its full-screen size).
    const changed = !sameOutputs(before, this.outputs);
    const zones = this.outputs.flatMap((output) => dragZones(output).map((zone) => ({ ...zone, usable: output.usable })));
    this.zones = zones.map(({ tile, frame, usable }) => ({ tile, frame, usable }));
    // Drag-to-tile is the compositor's to offer; without it, windows still fit their screens.
    await this.compositor
      .request("layout", { zones: zones.map(({ area, frame }) => ({ area, frame })), dwellMs: DWELL_MS })
      .catch((error) => console.error("dashi-shell: drag-to-tile is off:", error instanceof Error ? error.message : error));
    if (changed) await this.fitWindows();
  }

  /**
   * Windows that no longer fit their screen's usable area (a screen shrank,
   * or its scale grew) are moved in, and shrunk if they must; a tiled or
   * filled window takes its tile on the screen as it is now.
   */
  private async fitWindows(): Promise<void> {
    for (const window of await this.compositor.windows()) {
      // A full-screen window fills its screen, whatever the bars leave free.
      const frame = this.current(window);
      if (window.state !== "normal" || !frame || window.fullscreen) continue;
      const usable = usableFor(frame, this.outputs);
      if (!usable) continue;
      const tile = this.arranged.get(window.id)?.tile ?? null;
      const fitted = tile ? tileFrame(tile, usable) : fitFrame(frame, usable);
      if (!sameRect(fitted, frame)) await this.frame(window.id, fitted, tile);
    }
  }

  /** Where a new window goes, as any other (also for a claimed one that could not be placed its own way). */
  async place(window: Placing): Promise<void> {
    await this.ready;
    const usable = await this.usableForNew(window.id);
    if (!usable) return;
    // Where new windows go, kept inside the usable area: a window taller or
    // wider than it is shrunk to fit once placed (not left under the Dock).
    // An app that asked for a spot (X11 apps do) gets it; the rest cascade.
    const { x, y } = window.position ?? placeNew(window, usable, this.opened++);
    const fitted = fitFrame({ x, y, width: window.width, height: window.height }, usable);
    await this.compositor.request("place", { window: window.id, x: fitted.x, y: fitted.y });
    if (fitted.width !== window.width || fitted.height !== window.height) await this.frame(window.id, fitted);
  }

  /** Ask for a frame (Fill also tells the app it is maximized), and hold to its size until the app has drawn it. */
  private async frame(id: number, frame: Rect, tile: Tile | null = null): Promise<void> {
    await this.compositor.request("frame", { window: id, ...frame, ...(tile === "fill" ? { maximized: true } : {}) });
  }

  /** A window's frame as it is about to be: where it is, at the size its app is being asked to take until it has drawn it. */
  private current(window: CompositorWindow): Rect | null {
    return window.frame ? { ...window.frame, ...window.configuring } : null;
  }

  /** Run `work` after the arranging before it: one at a time, in the order asked. */
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => {});
    return next;
  }

  /** How the shell arranged a window: a tile, Fill, or null at its own frame (the menus, agents). */
  arrangement(window: number): Tile | null {
    return this.arranged.get(window)?.tile ?? null;
  }

  /** The frame of a window on screen that can be arranged (not full screen), or null. */
  private async frameOf(id: number): Promise<Rect | null> {
    await this.ready;
    const window = (await this.compositor.windows()).find((candidate) => candidate.id === id);
    return window && window.state === "normal" && !window.fullscreen ? this.current(window) : null;
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
    const arranged = this.arranged.get(id);
    const step = arrowStep(arranged?.tile ?? null, arrow);
    if (step.kind === "restore") return this.back(id);
    const screen = screenFor(frame, this.outputs);
    if (!screen) return;
    const own = arranged?.own ?? frame;
    if (step.kind === "tile") return this.tileIn(id, step.tile, screen.usable, own);
    const next = screenToward(screen.frame, this.outputs, arrow);
    // The last screen that way: nothing happens.
    if (next) await this.tileIn(id, step.tile, next.usable, carryFrame(own, screen.usable, next.usable));
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
    this.dragFrom.delete(id);
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
    const from = event.frame;
    if (!arranged) {
      this.dragFrom.set(event.window, from);
      return;
    }
    const frame = frameUnderPointer(from, arranged.own, event.pointer);
    this.dragFrom.set(event.window, frame);
    await this.frame(event.window, frame);
  }

  /** A drag let go in a drag-to-tile zone: that tile, going back to where the drag began. */
  private async dropped(event: EventOf<"window-drop">): Promise<void> {
    const zone = this.zones[event.zone];
    const from = this.dragFrom.get(event.window);
    this.dragFrom.delete(event.window);
    // Zones sent again since the drag began (a screen changed): this one may be gone.
    if (!zone || !sameRect(zone.frame, event.frame)) return;
    const frame = await this.frameOf(event.window);
    if (frame) await this.tileIn(event.window, zone.tile, zone.usable, from ?? frame);
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
    const window = (await this.compositor.windows()).find((candidate) => candidate.id === id);
    if (!window || window.state !== "normal" || (window.fullscreen ?? false) === on) return;
    const before = on ? this.current(window) : null;
    if (before) this.beforeFullscreen.set(id, before);
    // Leaving: the frame it goes back to is asked for at once, so nothing
    // meanwhile takes the full-screen size for its own.
    const back = on ? null : this.frameAfterFullscreen(id);
    await this.compositor.request("fullscreen", { window: id, on });
    if (back) await this.frame(id, back.frame, back.tile);
    this.afterFullscreen?.();
  }

  /** Out of full screen: the frame from before, or its tile there; nothing known (the shell restarted meanwhile), the compositor's own. */
  private frameAfterFullscreen(id: number): { frame: Rect; tile: Tile | null } | null {
    const before = this.beforeFullscreen.get(id);
    this.beforeFullscreen.delete(id);
    if (!before) return null;
    const tile = this.arranged.get(id)?.tile ?? null;
    const usable = usableFor(before, this.outputs);
    return tile && usable ? { frame: tileFrame(tile, usable), tile } : { frame: before, tile: null };
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
