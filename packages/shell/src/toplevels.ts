/**
 * Every window on the desktop, from the compositor (the `shell.toplevels`
 * capability), as a store React components subscribe to. The portal's
 * dialogs (dev.dashi.portal) are left out: each is a sheet of an app's window
 * (portal-host/), not an app of its own for the Dock or the switcher. They
 * are kept apart (`getDialogs`), so the menu bar can name one that has the
 * keyboard (bar-name.ts). So is the 1×1 window `wl-copy` and `wl-paste` map
 * for a moment to reach the clipboard (an app has no data-control, so they
 * take the keyboard with a window): it is no app, and while it has the
 * keyboard the app that asked is still the one in front (`getHelperActive`).
 */

import type { NativeHostTransport, Toplevel, ToplevelAction } from "@mirinjs/metal";
import { useSyncExternalStore } from "react";
import { PORTAL_APP_ID } from "./shared/portal-host/index.ts";

/** wl-clipboard's app id, on the window wl-copy and wl-paste map (the compositor's wm/windows/helper.rs knows it too). */
export const CLIPBOARD_HELPER_APP_ID = "io.github.bugaevc.wl-clipboard";

export class ToplevelStore {
  private readonly windows = new Map<number, Toplevel>();
  private readonly portal = new Map<number, Toplevel>();
  /** The clipboard helper windows that have the keyboard. */
  private readonly helpers = new Set<number>();
  private readonly listeners = new Set<() => void>();
  /** Insertion order: the order windows first appeared. */
  private snapshot: readonly Toplevel[] = [];
  private dialogSnapshot: readonly Toplevel[] = [];

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
    this.portal.clear();
    this.helpers.clear();
    this.publish();
    transport.onToplevel((event) => {
      if (this.transport !== transport) return;
      if (event.type === "changed") {
        if (event.toplevel.appId === CLIPBOARD_HELPER_APP_ID || this.helpers.has(event.toplevel.id)) {
          // Never listed; a window reported before it named its app is taken back.
          this.windows.delete(event.toplevel.id);
          if (event.toplevel.activated) this.helpers.add(event.toplevel.id);
          else this.helpers.delete(event.toplevel.id);
        } else if (event.toplevel.appId === PORTAL_APP_ID) {
          this.portal.set(event.toplevel.id, event.toplevel);
        } else {
          this.onReport?.(event.toplevel);
          this.windows.set(event.toplevel.id, event.toplevel);
        }
      } else {
        this.windows.delete(event.id);
        this.portal.delete(event.id);
        this.helpers.delete(event.id);
      }
      this.publish();
    });
  }

  private publish(): void {
    this.snapshot = [...this.windows.values()];
    this.dialogSnapshot = [...this.portal.values()];
    for (const listener of this.listeners) listener();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): readonly Toplevel[] => this.snapshot;

  /** The portal's dialog windows (an Access question, a file chooser), apart from the apps' windows. */
  getDialogs = (): readonly Toplevel[] => this.dialogSnapshot;

  /** Whether a clipboard helper window has the keyboard: the app that copies or pastes is still in front. */
  getHelperActive = (): boolean => this.helpers.size > 0;

  act(id: number, action: ToplevelAction): void {
    this.transport?.toplevel(id, action);
  }
}

export function useToplevels(store: ToplevelStore): readonly Toplevel[] {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

export function usePortalDialogs(store: ToplevelStore): readonly Toplevel[] {
  return useSyncExternalStore(store.subscribe, store.getDialogs);
}

export function useClipboardHelperActive(store: ToplevelStore): boolean {
  return useSyncExternalStore(store.subscribe, store.getHelperActive);
}
