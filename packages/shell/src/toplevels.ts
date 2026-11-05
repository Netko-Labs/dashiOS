/**
 * Every window on the desktop, from the compositor (the `shell.toplevels`
 * capability), as a store React components subscribe to. The portal's
 * dialogs (dev.dashi.portal) are left out: each is a sheet of an app's window
 * (portal-host/), not an app of its own for the Dock or the switcher.
 */

import type { NativeHostTransport, Toplevel, ToplevelAction } from "@mirinjs/metal";
import { useSyncExternalStore } from "react";
import { PORTAL_APP_ID } from "./portal-host/protocol.ts";

export class ToplevelStore {
  private readonly windows = new Map<number, Toplevel>();
  private readonly listeners = new Set<() => void>();
  /** Insertion order: the order windows first appeared. */
  private snapshot: readonly Toplevel[] = [];

  private transport: NativeHostTransport | null = null;
  /** Told of each window as it is reported, before anyone hears of the change (the app catalog looks up an app it doesn't know yet: app-catalog.ts). */
  onReport: ((toplevel: Toplevel) => void) | null = null;

  constructor(transport?: NativeHostTransport) {
    if (transport) this.attach(transport);
  }

  /**
   * Follow the windows a host reports. A new host (the Dock moved to another
   * screen) starts the list over: it reports every window again, and the old
   * host's late events are ignored.
   */
  attach(transport: NativeHostTransport): void {
    this.transport = transport;
    this.windows.clear();
    this.publish();
    transport.onToplevel((event) => {
      if (this.transport !== transport) return;
      if (event.type === "changed") {
        if (event.toplevel.appId === PORTAL_APP_ID) return;
        this.onReport?.(event.toplevel);
        this.windows.set(event.toplevel.id, event.toplevel);
      } else {
        this.windows.delete(event.id);
      }
      this.publish();
    });
  }

  private publish(): void {
    this.snapshot = [...this.windows.values()];
    for (const listener of this.listeners) listener();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): readonly Toplevel[] => this.snapshot;

  act(id: number, action: ToplevelAction): void {
    this.transport?.toplevel(id, action);
  }
}

export function useToplevels(store: ToplevelStore): readonly Toplevel[] {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
