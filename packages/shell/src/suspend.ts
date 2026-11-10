/**
 * Which windows are told no one can see them (PA-15): the shell's call, sent
 * as the compositor's `suspend` (docs/compositor-ipc.md), which the app hears
 * as xdg_toplevel's `suspended` state (Metal apps: the kit's
 * onWindowVisibility) or X11's `_NET_WM_STATE_HIDDEN`. A window is suspended
 * while it is off screen: minimized, hidden, or on a Desktop that isn't
 * shown (the compositor gives such a window no frame), and stops being so
 * when it shows again.
 */

import type { Compositor, CompositorEvent, CompositorWindow } from "./compositor/index.ts";

/** What the shell asks of the compositor here. */
export interface SuspendTarget {
  windows(): Promise<CompositorWindow[]>;
  suspend: Compositor["suspend"];
  on(listener: (event: CompositorEvent) => void): () => void;
}

/** Whether a window should be suspended: nothing of it is on screen. */
export function isOutOfSight(window: CompositorWindow): boolean {
  return window.frame === null;
}

/** The `suspend` requests that bring `told` (what each window was last told) to what `windows` say. */
export function suspendChanges(windows: readonly CompositorWindow[], told: ReadonlyMap<number, boolean>): { window: number; on: boolean }[] {
  return windows.flatMap((window) => {
    const on = isOutOfSight(window);
    // A window that opens is seen; it needs telling only once it goes.
    return on !== (told.get(window.id) ?? false) ? [{ window: window.id, on }] : [];
  });
}

const WATCHED: ReadonlySet<CompositorEvent["event"]> = new Set(["window-opened", "window-closed", "window-state", "window-space", "space"]);

/** Keep every window's `suspended` state with whether it is on screen; returns what stops it. */
export function followSuspension(compositor: SuspendTarget): () => void {
  const told = new Map<number, boolean>();
  const once = async (): Promise<void> => {
    let windows: CompositorWindow[];
    try {
      windows = await compositor.windows();
    } catch {
      return;
    }
    const open = new Set(windows.map((window) => window.id));
    for (const id of told.keys()) if (!open.has(id)) told.delete(id);
    for (const change of suspendChanges(windows, told)) {
      told.set(change.window, change.on);
      // A window that closed meanwhile is an error to ignore.
      compositor.suspend(change).catch(() => told.delete(change.window));
    }
  };
  // One look at a time, so an older answer never lands after a newer one; changes meanwhile look again.
  let running = false;
  let again = false;
  const soon = (): void => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    void (async () => {
      do {
        again = false;
        await once();
      } while (again);
      running = false;
    })();
  };
  soon();
  return compositor.on((event) => {
    if (WATCHED.has(event.event)) soon();
  });
}
