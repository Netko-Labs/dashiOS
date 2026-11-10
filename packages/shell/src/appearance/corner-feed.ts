/**
 * The Appearance setting's corner radius as a small store, so the GTK block
 * (index.ts) can follow it although settings are read before appearance
 * starts: whoever reads the settings calls `set`, and the follower subscribes.
 */

import { CORNER_RADIUS, type CornerName, DEFAULT_CORNERS } from "../shared/appearance/index.ts";

export interface CornerSource {
  subscribe: (listener: () => void) => () => void;
  /** The radius in logical pixels. */
  getSnapshot: () => number;
}

export class CornerFeed implements CornerSource {
  private radius = CORNER_RADIUS[DEFAULT_CORNERS];
  private readonly listeners = new Set<() => void>();

  set(corners: CornerName): void {
    const radius = CORNER_RADIUS[corners];
    if (radius === this.radius) return;
    this.radius = radius;
    for (const listener of [...this.listeners]) listener();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): number => this.radius;
}
