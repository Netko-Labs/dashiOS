/**
 * The on-screen display's state and lifetime, apart from how it is drawn: a
 * volume or brightness key shows it, more presses while it is up update it,
 * and it goes away a moment after the last one.
 */

import { useSyncExternalStore } from "react";

export type OsdState =
  | { kind: "volume"; level: number; muted: boolean }
  | { kind: "brightness"; level: number }
  | { kind: "mic"; muted: boolean }
  /** A charger was plugged in: charging (`true`) or holding its charge (`"plugged"`). */
  | { kind: "power"; percent: number; charge: true | "plugged" }
  /** The laptop's mode key (Fn F5) or the firmware changed the power mode (laptop/). */
  | { kind: "mode"; mode: "low-power" | "balanced" | "performance"; label: string }
  /** The trackpad's key turned it off or on. */
  | { kind: "trackpad"; on: boolean }
  /** The keyboard light's key: its level of `max`. */
  | { kind: "keyboard-light"; level: number; max: number };

/** The HUD's measures, in px. */
export const OSD = {
  /** The rounded square. */
  size: 200,
  /** Room around it for the shadow. */
  margin: 24,
  /** Level bar segments: one per key step. */
  segments: 16,
  /** It stays this long after the last change. */
  hideMs: 1500,
} as const;

/** How many of the bar's segments are lit for a level of 0 to 1. */
export function filledSegments(level: number): number {
  if (!Number.isFinite(level)) return 0;
  return Math.round(Math.min(Math.max(level, 0), 1) * OSD.segments);
}

/** The bar's lit segments for what the HUD shows; muted is empty. */
export function litSegments(state: OsdState): number {
  switch (state.kind) {
    case "volume":
      return state.muted ? 0 : filledSegments(state.level);
    case "brightness":
      return filledSegments(state.level);
    case "keyboard-light":
      return state.max > 0 ? filledSegments(state.level / state.max) : 0;
    case "mode":
    case "trackpad":
    case "mic":
    case "power":
      return 0;
  }
}

export class OsdStore {
  private state: OsdState = { kind: "volume", level: 0, muted: false };
  private readonly listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): OsdState => this.state;

  set(state: OsdState): void {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}

export function useOsd(store: OsdStore): OsdState {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

/**
 * Opens the HUD's surface and shows `store` in it; returns what closes it.
 * `onClosed` is called if the surface goes away by itself.
 */
export type OpenOsd = (store: OsdStore, onClosed: () => void) => () => void;

/** The one HUD: opened on the first change, reused until it times out. */
export class OsdController {
  private readonly store = new OsdStore();
  private close: (() => void) | null = null;
  /** Which opened surface is current: a late close from an old one is not news. */
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly open: OpenOsd,
    private readonly hideMs: number = OSD.hideMs,
  ) {}

  /** Whether the HUD is on screen. */
  get visible(): boolean {
    return this.close !== null;
  }

  show(state: OsdState): void {
    this.store.set(state);
    if (!this.close) {
      const generation = ++this.generation;
      this.close = this.open(this.store, () => {
        if (generation !== this.generation) return;
        this.close = null;
        clearTimeout(this.timer);
      });
    }
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.hide(), this.hideMs);
  }

  hide(): void {
    clearTimeout(this.timer);
    const close = this.close;
    this.close = null;
    this.generation++;
    close?.();
  }
}
