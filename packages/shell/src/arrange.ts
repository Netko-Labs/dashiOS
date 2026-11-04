/**
 * Arranging windows: layout.ts's geometry, applied through the compositor.
 * It sends the drag zones (again whenever the screens or the menu bar and
 * Dock change them), places each new window as the compositor asks, tiles
 * on request (shortcuts, agents), and decides what zoom and full screen do.
 */

import { type Compositor, type Placing, parseFrame, parsePointer } from "./compositor.ts";
import { dragZones, fitFrame, type Output, placeNew, type Rect, type Tile, tileFrame, usableFor, zoomFrame } from "./layout.ts";

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

export class Arranger {
  private outputs: Output[] = [];
  private opened = 0;
  /** The first refresh; placing and zooming wait for it, since they need the screens. */
  private ready: Promise<void> = Promise.resolve();

  /** Runs after a window entered or left full screen (fullscreen.ts follows the bars). */
  afterFullscreen: (() => void) | null = null;

  constructor(private readonly compositor: Compositor) {}

  /** Take over placing windows and send the drag zones; returns a stop function. */
  async start(): Promise<() => void> {
    // Listen before the first refresh: windows that open meanwhile are asked
    // about once, and a second asking would never come.
    const stop = this.compositor.on((event) => {
      const run = (work: Promise<unknown>) => work.catch((error) => console.error("dashi-shell: arranging:", error));
      if (event.event === "outputs-changed") run(this.refresh());
      else if (event.event === "window-placing") run(this.place(event.window));
      else if (event.event === "zoom") run(this.zoom(event.window));
      else if (event.event === "fullscreen") run(this.fullscreen(event.window, event.on));
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
   * The usable area of the screen a window acts on. Tiling and zooming use the
   * window's own screen. A new window has no frame yet, so it goes to the
   * screen with the pointer (`session` says where it is), else to the screen
   * of the window that has the keyboard; with one screen, or nothing known,
   * the first.
   */
  private async usableFor(options: { window: number } | { placing: number }): Promise<Rect | null> {
    const first = this.outputs[0]?.usable ?? null;
    if (this.outputs.length < 2) return first;
    if ("placing" in options) {
      const pointer = parsePointer(await this.compositor.request("session").catch(() => null));
      // A zero-size frame at the pointer: the screen holding that point.
      if (pointer) return usableFor({ ...pointer, width: 0, height: 0 }, this.outputs);
    }
    try {
      const windows = await this.compositor.windows();
      const target =
        "window" in options
          ? windows.find((candidate) => candidate.id === options.window)
          : windows.find((candidate) => candidate.focused && candidate.id !== options.placing && candidate.state === "normal");
      return target?.frame ? usableFor(target.frame, this.outputs) : first;
    } catch {
      // The session is locked, or the window is gone: the first screen is still a place.
      return first;
    }
  }

  private async refresh(): Promise<void> {
    this.outputs = parseOutputs(await this.compositor.request("outputs"));
    // Drag-to-tile is the compositor's to offer; without it, windows still fit their screens.
    await this.compositor
      .request("layout", { zones: this.outputs.flatMap(dragZones), dwellMs: DWELL_MS })
      .catch((error) => console.error("dashi-shell: drag-to-tile is off:", error instanceof Error ? error.message : error));
    await this.fitWindows();
  }

  /** Windows that no longer fit their screen's usable area (a screen shrank, or its scale grew) are moved in, and shrunk if they must. */
  private async fitWindows(): Promise<void> {
    for (const window of await this.compositor.windows()) {
      // A full-screen window fills its screen, whatever the bars leave free.
      if (window.state !== "normal" || !window.frame || window.fullscreen) continue;
      const usable = usableFor(window.frame, this.outputs);
      if (!usable) continue;
      const fitted = fitFrame(window.frame, usable);
      const { x, y, width, height } = window.frame;
      if (fitted.x === x && fitted.y === y && fitted.width === width && fitted.height === height) continue;
      await this.compositor.request("frame", { window: window.id, ...fitted });
    }
  }

  private async place(window: Placing): Promise<void> {
    await this.ready;
    const usable = await this.usableFor({ placing: window.id });
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

  /** Snap a window into a tile, or back to its own frame. */
  async tile(window: number, tile: Tile): Promise<void> {
    if (tile === "restore") {
      await this.compositor.request("restore", { window });
      return;
    }
    const usable = await this.usableFor({ window });
    if (usable) await this.compositor.request("frame", { window, ...tileFrame(tile, usable), remember: true });
  }

  /** Zoom fills the usable area; zooming a zoomed (or tiled) window restores it (the zoom control, the View menu). */
  async zoom(id: number): Promise<void> {
    await this.ready;
    const window = (await this.compositor.windows()).find((candidate) => candidate.id === id);
    if (!window || window.fullscreen) return;
    if (window.zoomed) return void (await this.compositor.request("restore", { window: id }));
    const usable = window.frame ? usableFor(window.frame, this.outputs) : (this.outputs[0]?.usable ?? null);
    if (usable) await this.compositor.request("frame", { window: id, ...zoomFrame(usable), remember: true, maximized: true });
  }

  /**
   * Full screen: the window covers its whole screen, over the menu bar and
   * Dock, and leaving gives the frame back (the green light, ⌃❖F, the View
   * menu, an app's own F11 or video button). ⌥ on the green light zooms
   * instead (the compositor sends `zoom` for that). The compositor picks the
   * screen the window is mostly on.
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
