/**
 * Which kinds of pointer device are connected, as dashi-comp says: a
 * trackpad, a mouse (one on USB or Bluetooth). Settings › Trackpad shows its
 * switches only where there is a trackpad, and the trackpad key does nothing
 * where there is none. Until the compositor has answered (or with none:
 * a nested run, a test) nothing is known, and a trackpad is taken to be there.
 */

import { useSyncExternalStore } from "react";
import type { CompositorEvent, Pointers } from "../compositor/index.ts";

/** What of dashi-comp this follows. */
export interface PointerSource {
  pointers(): Promise<Pointers>;
  on(listener: (event: CompositorEvent) => void): () => void;
}

export class PointerDevices {
  private state: Pointers | null = null;
  private readonly listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Null until the compositor has said. */
  getSnapshot = (): Pointers | null => this.state;

  /** Whether there is a trackpad, as far as anyone knows. */
  get hasTrackpad(): boolean {
    return this.state?.touchpad ?? true;
  }

  set(pointers: Pointers): void {
    if (this.state?.touchpad === pointers.touchpad && this.state.mouse === pointers.mouse) return;
    this.state = { touchpad: pointers.touchpad, mouse: pointers.mouse };
    for (const listener of this.listeners) listener();
  }

  /** Asks now and hears every change; returns what stops it. An older dashi-comp that cannot say leaves it unknown. */
  follow(source: PointerSource): () => void {
    let heard = false;
    const stop = source.on((event) => {
      if (event.event !== "pointers") return;
      heard = true;
      this.set(event);
    });
    source.pointers().then(
      (pointers) => {
        if (!heard) this.set(pointers);
      },
      () => {},
    );
    return stop;
  }
}

export function usePointers(devices: PointerDevices | null | undefined): Pointers | null {
  return useSyncExternalStore(devices?.subscribe ?? NOTHING, () => devices?.getSnapshot() ?? null);
}

const NOTHING = (): (() => void) => () => {};
