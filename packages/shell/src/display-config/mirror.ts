/**
 * Mirroring (Control Center's tile, Settings › Displays): every other screen
 * shows the built-in one's picture, or the main display's on a desk with no
 * built-in screen. The compositor draws it (IPC `mirror`, outputs/mirror.rs:
 * scaled to fit, black bars where the shapes differ); which screen shows which
 * is decided here. It lasts while the screens do: a screen unplugged ends its
 * part, and a new login starts with each screen its own.
 */

import { useSyncExternalStore } from "react";
import type { Compositor } from "../compositor.ts";
import { type Monitor, parseMonitors } from "./monitors.ts";

export interface MirrorState {
  /** Screens that are on, mirroring ones included. */
  screens: number;
  /** Some screen shows another's picture. */
  on: boolean;
}

/** The screen the others show: the built-in one, else the main display, else the first. Null with fewer than two. */
export function mirrorSource(monitors: readonly Monitor[]): string | null {
  const on = monitors.filter((monitor) => monitor.enabled);
  if (on.length < 2) return null;
  const own = on.filter((monitor) => monitor.mirrorOf === undefined);
  return (own.find((monitor) => monitor.builtIn) ?? own.find((monitor) => monitor.primary) ?? own[0])?.name ?? null;
}

/** The `mirror` requests that turn mirroring on (every other screen shows the source) or off (each shows its own). */
export function mirrorRequests(monitors: readonly Monitor[], on: boolean): Array<{ output: string; source: string | null }> {
  if (!on) return monitors.flatMap((monitor) => (monitor.mirrorOf !== undefined ? [{ output: monitor.name, source: null }] : []));
  const source = mirrorSource(monitors);
  if (source === null) return [];
  return monitors.flatMap((monitor) => (monitor.enabled && monitor.name !== source && monitor.mirrorOf !== source ? [{ output: monitor.name, source }] : []));
}

export const mirrorStateOf = (monitors: readonly Monitor[]): MirrorState => ({
  screens: monitors.filter((monitor) => monitor.enabled).length,
  on: monitors.some((monitor) => monitor.mirrorOf !== undefined),
});

const same = (a: MirrorState, b: MirrorState): boolean => a.screens === b.screens && a.on === b.on;

/** Mirroring as one switch, following the screens (`outputs-changed`). */
export class MirrorStore {
  private snapshot: MirrorState = { screens: 0, on: false };
  private readonly listeners = new Set<() => void>();
  private stop: (() => void) | null = null;

  constructor(private readonly compositor: Pick<Compositor, "request" | "on">) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): MirrorState => this.snapshot;

  /** Follow the screens until the returned function is called. */
  start(): () => void {
    this.stop ??= this.compositor.on((event) => {
      if (event.event === "outputs-changed") void this.refresh();
    });
    void this.refresh();
    return () => {
      this.stop?.();
      this.stop = null;
    };
  }

  async refresh(): Promise<void> {
    try {
      this.publish(mirrorStateOf(parseMonitors(await this.compositor.request("outputs"))));
    } catch (error) {
      console.error("dashi-shell: couldn't read the screens for mirroring:", error);
    }
  }

  /** Mirror the screens, or give each its own desktop again. */
  async set(on: boolean): Promise<void> {
    try {
      const monitors = parseMonitors(await this.compositor.request("outputs"));
      for (const request of mirrorRequests(monitors, on)) await this.compositor.request("mirror", request);
    } catch (error) {
      console.error(`dashi-shell: couldn't turn mirroring ${on ? "on" : "off"}:`, error);
    }
    await this.refresh();
  }

  private publish(next: MirrorState): void {
    if (same(next, this.snapshot)) return;
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
}

const NONE = { subscribe: () => () => {}, getSnapshot: (): MirrorState => ({ screens: 0, on: false }) };

export function useMirror(store: MirrorStore | null | undefined): MirrorState {
  const source = store ?? NONE;
  return useSyncExternalStore(source.subscribe, source.getSnapshot);
}
