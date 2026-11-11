/**
 * Tells the compositor where each window's Dock tile is (IPC
 * `animation-target`), so a window minimizes by shrinking toward it and
 * comes back by growing out of it. The tiles are known only here: Metal lays
 * the Dock out and reports each tile's bounds on the Dock's surface
 * (tiles.ts); the surface is anchored to the primary screen's bottom edge, so
 * a tile's place on the desktop is the screen's frame plus the surface's
 * offset plus the bounds. The compositor never asks where anything is.
 *
 * Windows are matched to tiles the way the Dock matches them to apps
 * (layout.ts `appKey`), so every window of an app aims at the app's tile.
 * Targets are resent only when one changed, and a window whose tile
 * disappeared is told to forget it.
 */

import type { Bounds } from "@mirinjs/metal";
import type { AnimationTarget, Compositor, CompositorWindow, Frame, Output } from "../compositor/index.ts";
import { screensOf } from "../displays.ts";
import { pickPrimary } from "../menubar/menubars.ts";
import type { Entry } from "../shared/app-entries/index.ts";
import { DOCK, DOCK_HEIGHT, TASKBAR } from "../theme.ts";
import { appKey } from "./layout.ts";
import type { DockSettings } from "./settings.ts";
import type { TileStore } from "./tiles.ts";

/** The screen the Dock is on, and how the Dock sits on it. */
export interface Placement {
  screen: Frame;
  style: DockSettings["style"];
}

/** The Dock's screen in an IPC `outputs` answer: `home` (the primary bar's) when it is there, else the one a primary is chosen on. */
export function dockScreen(outputs: readonly Output[], home: string | null | undefined): Frame | null {
  const screens = screensOf(outputs);
  const name = pickPrimary(
    screens.map((screen) => screen.name),
    home,
  );
  return screens.find((screen) => screen.name === name)?.frame ?? null;
}

/** The tile's rectangle on the desktop, whole pixels. The Dock's surface hugs the bottom edge, above its margin. */
export function tileRect(bounds: Bounds, { screen, style }: Placement): Frame {
  const taskbar = style === "taskbar";
  const height = taskbar ? TASKBAR.height : DOCK_HEIGHT;
  const margin = taskbar ? 0 : DOCK.margin;
  const top = screen.y + screen.height - margin - height;
  return {
    x: Math.round(screen.x + bounds.x),
    y: Math.round(top + bounds.y),
    width: Math.max(1, Math.round(bounds.width)),
    height: Math.max(1, Math.round(bounds.height)),
  };
}

const same = (a: Frame | null, b: Frame | null): boolean =>
  a === b || (a !== null && b !== null && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height);

/**
 * The targets that changed: each window's tile now against what was sent
 * (`sent`, by window id). Windows that are gone from `sent` are dropped, and
 * a window with no tile (or no Dock) that had one is sent `null`.
 */
export function changedTargets(
  windows: readonly Pick<CompositorWindow, "id" | "appId">[],
  catalog: readonly Entry[],
  tiles: Pick<TileStore, "get">,
  placement: Placement | null,
  sent: Map<number, Frame | null>,
): AnimationTarget[] {
  const changes: AnimationTarget[] = [];
  const alive = new Set<number>();
  for (const window of windows) {
    alive.add(window.id);
    const bounds = placement ? tiles.get(appKey(catalog, window)) : undefined;
    const rect = bounds && placement ? tileRect(bounds, placement) : null;
    if (same(sent.get(window.id) ?? null, rect)) continue;
    sent.set(window.id, rect);
    changes.push({ window: window.id, rect });
  }
  for (const id of sent.keys()) if (!alive.has(id)) sent.delete(id);
  return changes;
}

export interface AnimationTargetsDeps {
  compositor: Pick<Compositor, "windows" | "animationTarget" | "on">;
  catalog: readonly Entry[];
  tiles: TileStore;
  /** Where the Dock is now; null when it is not on screen. */
  placement(): Promise<Placement | null>;
  /** Waits for the layout to settle after a change; tests run it at once. */
  later?(fn: () => void, ms: number): () => void;
}

/** Changes arrive in bursts (a tile per icon as the Dock is laid out): one pass answers them all. */
const SETTLE_MS = 120;

const defer = (fn: () => void, ms: number): (() => void) => {
  const timer = setTimeout(fn, ms);
  return () => clearTimeout(timer);
};

export class AnimationTargets {
  private readonly sent = new Map<number, Frame | null>();
  private cancel: (() => void) | null = null;
  private stops: Array<() => void> = [];
  private busy = false;
  private again = false;

  constructor(private readonly deps: AnimationTargetsDeps) {}

  start(): () => void {
    const { compositor, tiles } = this.deps;
    this.stops.push(
      tiles.subscribe(() => this.schedule()),
      compositor.on((event) => {
        if (event.event === "window-opened" || event.event === "window-closed" || event.event === "outputs-changed") this.schedule();
      }),
    );
    this.schedule();
    return () => this.stop();
  }

  stop(): void {
    this.cancel?.();
    this.cancel = null;
    for (const stop of this.stops) stop();
    this.stops = [];
  }

  /** Ask for a pass soon; asking again before it runs costs nothing. */
  schedule(): void {
    if (this.cancel) return;
    const later = this.deps.later ?? defer;
    this.cancel = later(() => {
      this.cancel = null;
      void this.pass();
    }, SETTLE_MS);
  }

  /** Send what changed. One pass at a time; a change during a pass earns another. */
  async pass(): Promise<void> {
    if (this.busy) {
      this.again = true;
      return;
    }
    this.busy = true;
    try {
      const { compositor, catalog, tiles } = this.deps;
      const [windows, placement] = await Promise.all([compositor.windows(), this.deps.placement()]);
      const changes = changedTargets(windows, catalog, tiles, placement, this.sent);
      if (changes.length > 0) await compositor.animationTarget({ targets: changes });
    } catch (error) {
      // The compositor may be older, or the window gone; the next change tries again from scratch.
      this.sent.clear();
      console.error("dashi-shell: window animations lose their Dock targets:", error instanceof Error ? error.message : error);
    } finally {
      this.busy = false;
      if (this.again) {
        this.again = false;
        this.schedule();
      }
    }
  }
}
