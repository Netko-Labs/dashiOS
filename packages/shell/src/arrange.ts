/**
 * Arranging windows: layout.ts's geometry, applied through the compositor.
 * It sends the drag zones (again whenever the screens or the menu bar and
 * Dock change them), places each new window as the compositor asks, and
 * decides what the square, a title-bar double-click, the ⌃❖ keys, the
 * Window menu, agents, and full screen do. It remembers how each window is
 * arranged (a tile or Fill) and the frame it had before: what Back to
 * Previous Size gives back. A drag or a resize by the person ends the
 * arrangement: the compositor reports the grab, the shell decides.
 */

import { type Compositor, type CompositorEvent, type Placing, parseFrame, parsePointer } from "./compositor.ts";
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

const sameRect = (a: Rect, b: Rect): boolean => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

/** The frame request for `tile`: Fill also tells the app it is maximized. */
const tileRequest = (window: number, tile: Tile, frame: Rect) => ({ window, ...frame, ...(tile === "fill" ? { maximized: true } : {}) });

export class Arranger {
  private outputs: Output[] = [];
  private opened = 0;
  private readonly arranged = new Map<number, Arranged>();
  /** Where each dragged window was as its drag began: its own frame, if the drag ends in a tile. */
  private readonly dragFrom = new Map<number, Rect>();
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
      if (event.event === "outputs-changed") run(this.refresh());
      else if (event.event === "window-placing") run(this.claim?.(event.window) ? Promise.resolve() : this.place(event.window));
      else if (event.event === "window-control") run(this.control(event.window, event.alt));
      else if (event.event === "zoom") run(this.zoom(event.window, event.on));
      else if (event.event === "fullscreen") run(this.fullscreen(event.window, event.on));
      else if (event.event === "window-grab") run(this.grabbed(event));
      else if (event.event === "window-drop") run(this.dropped(event));
      else if (event.event === "window-closed") this.forget(event.id);
    });
    this.ready = this.refresh();
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
    this.outputs = parseOutputs(await this.compositor.request("outputs"));
    const zones = this.outputs.flatMap((output) => dragZones(output).map((zone) => ({ ...zone, usable: output.usable })));
    this.zones = zones.map(({ tile, frame, usable }) => ({ tile, frame, usable }));
    // Drag-to-tile is the compositor's to offer; without it, windows still fit their screens.
    await this.compositor
      .request("layout", { zones: zones.map(({ area, frame }) => ({ area, frame })), dwellMs: DWELL_MS })
      .catch((error) => console.error("dashi-shell: drag-to-tile is off:", error instanceof Error ? error.message : error));
    await this.fitWindows();
  }

  /**
   * Windows that no longer fit their screen's usable area (a screen shrank,
   * or its scale grew) are moved in, and shrunk if they must; a tiled or
   * filled window takes its tile on the screen as it is now.
   */
  private async fitWindows(): Promise<void> {
    for (const window of await this.compositor.windows()) {
      // A full-screen window fills its screen, whatever the bars leave free.
      if (window.state !== "normal" || !window.frame || window.fullscreen) continue;
      const usable = usableFor(window.frame, this.outputs);
      if (!usable) continue;
      const tile = this.arranged.get(window.id)?.tile;
      const fitted = tile ? tileFrame(tile, usable) : fitFrame(window.frame, usable);
      if (sameRect(fitted, window.frame)) continue;
      await this.compositor.request("frame", tile ? tileRequest(window.id, tile, fitted) : { window: window.id, ...fitted });
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
    if (fitted.width !== window.width || fitted.height !== window.height) {
      await this.compositor.request("frame", { window: window.id, ...fitted });
    }
  }

  /** How the shell arranged a window: a tile, Fill, or null at its own frame (the menus, agents). */
  arrangement(window: number): Tile | null {
    return this.arranged.get(window)?.tile ?? null;
  }

  /** The frame of a window on screen that can be arranged (not full screen), or null. */
  private async frameOf(id: number): Promise<Rect | null> {
    await this.ready;
    const window = (await this.compositor.windows()).find((candidate) => candidate.id === id);
    return window?.frame && window.state === "normal" && !window.fullscreen ? window.frame : null;
  }

  /** Tile it, fill, center it at its own size, or give it its own frame back (the Window menu, ⌃❖↩ ⌃❖C ⌃❖R, agents). */
  async arrange(id: number, to: Arrange): Promise<void> {
    const frame = await this.frameOf(id);
    if (!frame) return;
    if (to === "restore") return this.back(id);
    const usable = usableFor(frame, this.outputs);
    if (!usable) return;
    const own = this.arranged.get(id)?.own ?? frame;
    if (to !== "center") return this.tileIn(id, to, usable, own);
    this.forget(id);
    await this.compositor.request("frame", { window: id, ...centerFrame(own, usable) });
  }

  /** ⌃❖ and an arrow: the half, the quarter, its own size, or the next screen (tiling.ts). */
  async arrow(id: number, arrow: Arrow): Promise<void> {
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
    await this.compositor.request("frame", tileRequest(id, tile, tileFrame(tile, usable)));
  }

  /** Its own frame back (Back to Previous Size); nothing when it isn't arranged. */
  private async back(id: number): Promise<void> {
    const arranged = this.arranged.get(id);
    if (!arranged) return;
    this.forget(id);
    const usable = usableFor(arranged.own, this.outputs);
    await this.compositor.request("frame", { window: id, ...(usable ? fitFrame(arranged.own, usable) : arranged.own) });
  }

  private forget(id: number): void {
    this.arranged.delete(id);
    this.dragFrom.delete(id);
  }

  /**
   * The square, or a double-click on the title bar: Fill, or its own frame
   * back when it is filled or tiled; with ⌥, full screen. On a full-screen
   * window it leaves full screen.
   */
  async control(id: number, alt: boolean): Promise<void> {
    await this.ready;
    const window = (await this.compositor.windows()).find((candidate) => candidate.id === id);
    if (!window || window.state !== "normal") return;
    if (alt || window.fullscreen) return this.fullscreen(id, !(window.fullscreen ?? false));
    if (this.arranged.has(id)) return this.back(id);
    await this.arrange(id, "fill");
  }

  /**
   * An app asked to be maximized (its own title bar's double-click), or a
   * taskbar did: as the square. Asked not to be, it only ever goes back.
   */
  async zoom(id: number, on?: boolean): Promise<void> {
    if (!(await this.frameOf(id))) return;
    if (on === false || this.arranged.has(id)) return this.back(id);
    await this.arrange(id, "fill");
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
    if (!arranged) {
      this.dragFrom.set(event.window, event.frame);
      return;
    }
    const frame = frameUnderPointer(event.frame, arranged.own, event.pointer);
    this.dragFrom.set(event.window, frame);
    await this.compositor.request("frame", { window: event.window, ...frame });
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
   * menu, an app's own F11 or video button). A tiled or filled window stays
   * so underneath. The compositor picks the screen the window is mostly on.
   */
  async fullscreen(id: number, on: boolean): Promise<void> {
    await this.ready;
    const window = (await this.compositor.windows()).find((candidate) => candidate.id === id);
    if (!window || window.state !== "normal" || (window.fullscreen ?? false) === on) return;
    await this.compositor.request("fullscreen", { window: id, on });
    this.afterFullscreen?.();
  }

  /** Enter full screen, or leave it (⌃❖F, the View menu). */
  async toggleFullscreen(id: number): Promise<void> {
    await this.ready;
    const window = (await this.compositor.windows()).find((candidate) => candidate.id === id);
    if (window) await this.fullscreen(id, !(window.fullscreen ?? false));
  }
}
