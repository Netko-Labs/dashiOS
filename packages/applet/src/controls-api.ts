/**
 * `applet.controls`: an applet's controls in Control Center from
 * `defineApplet` (docs/applets.md, "Version 5: Control Center"). `update`
 * says a control's state, `on` hears it pressed, `onOpen` hears its label (or
 * a status tile) pressed, which opens the applet's popover when nothing else
 * listens.
 *
 *   applet.controls.update("lid", { on: true, detail: "Bounce" });
 *   applet.controls.on("lid", (action) => action.action === "toggle" && slash.set({ enabled: action.on }));
 *   applet.controls.onOpen("cpu", () => applet.openPopover());
 */

import type { AppletsClient } from "./client.ts";
import type { ControlAction, ControlUpdate } from "./controls.ts";

export interface ControlsApi {
  /** A control's state: what is given replaces those parts. False for a control applet.json doesn't declare. */
  update(id: string, state: Omit<ControlUpdate, "id">): boolean;
  /** Hear a control pressed (toggled, chosen, set, pressed); returns what stops it. */
  on(id: string, handler: (action: ControlAction) => void): () => void;
  /** Hear a control's label pressed, or a status tile; returns what stops it. */
  onOpen(id: string, handler: () => void): () => void;
  /** Which controls the person has in Control Center now. */
  readonly shown: readonly string[];
  /** Hear `shown` change; returns what stops it. */
  onShown(listener: (shown: readonly string[]) => void): () => void;
}

/** The controls API over a client; `openPopover` is what an unheard open does. */
export function controlsApi(client: AppletsClient, openPopover: () => void): ControlsApi {
  const handlers = new Map<string, Set<(action: ControlAction) => void>>();
  const openers = new Map<string, Set<() => void>>();
  const shownListeners = new Set<(shown: readonly string[]) => void>();
  const add = <T>(map: Map<string, Set<T>>, id: string, handler: T): (() => void) => {
    const set = map.get(id) ?? new Set<T>();
    set.add(handler);
    map.set(id, set);
    return () => set.delete(handler);
  };
  client.onControls({
    onAction: ({ id, ...action }) => {
      if (action.action === "open") {
        const listening = [...(openers.get(id) ?? [])];
        if (listening.length === 0) openPopover();
        for (const opener of listening) opener();
        return;
      }
      for (const handler of [...(handlers.get(id) ?? [])]) handler(action);
    },
    onShown: (shown) => {
      for (const listener of [...shownListeners]) listener(shown);
    },
  });
  return {
    update: (id, state) => client.updateControl({ ...state, id }),
    on: (id, handler) => add(handlers, id, handler),
    onOpen: (id, handler) => add(openers, id, handler),
    get shown() {
      return client.shownControls;
    },
    onShown: (listener) => {
      shownListeners.add(listener);
      return () => shownListeners.delete(listener);
    },
  };
}
