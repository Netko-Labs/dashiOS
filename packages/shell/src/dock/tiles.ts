/**
 * Where the Dock's tiles are on its surface, as the Dock's own layout puts
 * them (Metal reports each one's bounds when it is laid out). The compositor
 * shrinks a minimizing window toward its tile (animation-targets.ts), so the
 * tiles are remembered by the app they stand for.
 */

import type { Bounds } from "@mirinjs/metal";

export class TileStore {
  private readonly bounds = new Map<string, Bounds>();
  private readonly listeners = new Set<() => void>();

  /** Remember where the tile of app `key` is; listeners hear only a real move. */
  set(key: string, next: Bounds): void {
    const was = this.bounds.get(key);
    if (was && was.x === next.x && was.y === next.y && was.width === next.width && was.height === next.height) return;
    this.bounds.set(key, next);
    for (const listener of this.listeners) listener();
  }

  /** The Dock closed or was rebuilt (another style, another screen): its tiles are gone. */
  clear(): void {
    if (this.bounds.size === 0) return;
    this.bounds.clear();
    for (const listener of this.listeners) listener();
  }

  get(key: string): Bounds | undefined {
    return this.bounds.get(key);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
}
