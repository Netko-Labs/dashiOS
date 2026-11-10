/**
 * A shell sheet that takes the keyboard for the app in front (Settings'
 * Change Password, a Wi-Fi password, polkit's) is a layer surface, not a
 * window: while it has the keyboard no window is focused, and the menu bar
 * would say "Desktop" and drop the app's menus. While one is up the bar keeps
 * the name and menus it showed, as it does for its own popovers
 * (menubar.tsx, app-menus/start.ts `hold`). The ❖ chords typed in the sheet
 * reach its field as Ctrl chords (keymap.ts: a surface with no app id is no
 * Metal app's).
 */

import { useSyncExternalStore } from "react";
import type { OpenOverlay, OverlayHandle } from "../overlay.tsx";

/** After a sheet closes, how long the window is given to get the keyboard back before the bar follows focus again. */
export const SETTLE_MS = 250;

export class BarHold {
  private count = 0;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly later: (run: () => void, ms: number) => void = (run, ms) => void setTimeout(run, ms)) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Whether a sheet holds the bar now. */
  getSnapshot = (): boolean => this.count > 0;

  /** A sheet took the keyboard: the bar holds until the returned release (idempotent), and a moment after it. */
  begin(): () => void {
    this.change(1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.later(() => this.change(-1), SETTLE_MS);
    };
  }

  private change(by: number): void {
    const was = this.count > 0;
    this.count = Math.max(0, this.count + by);
    if (was !== this.count > 0) for (const listener of this.listeners) listener();
  }
}

/** The shell's one hold, which every menu bar reads. */
export const barHold = new BarHold();

/** `open`, holding the bar while each surface it opens is up. */
export function holdingBar(open: OpenOverlay, hold: BarHold = barHold): OpenOverlay {
  return (options, element, onClosed, onHost) => {
    const release = hold.begin();
    const handle = open(
      options,
      element,
      () => {
        release();
        onClosed?.();
      },
      onHost,
    );
    const held: OverlayHandle = {
      close() {
        release();
        handle.close();
      },
    };
    if (handle.exited) held.exited = handle.exited;
    if (handle.scroll) held.scroll = (testID, dy) => handle.scroll?.(testID, dy);
    return held;
  };
}

export function useBarHeld(hold: BarHold = barHold): boolean {
  return useSyncExternalStore(hold.subscribe, hold.getSnapshot);
}
