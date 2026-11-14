/** When the window in front changes under a shell surface that has the keyboard (start-pill.tsx: the bar's field closes then). */

import type { CompositorEvent } from "../compositor/index.ts";
import { PORTAL_APP_ID } from "../shared/portal-host/index.ts";
import { CLIPBOARD_HELPER_APP_ID } from "../toplevels.ts";

/**
 * Tells when the window in front changed while a shell surface has the keyboard (no window is focused then, so focus says
 * nothing): a window opened or closed, another Space, Mission Control, the ❖Tab switcher. The clipboard's helper window
 * (wl-copy's, 1×1) and the portal's dialogs are no change of what is in front.
 */
export function frontWatch(listener: () => void): (event: CompositorEvent) => void {
  const quiet = new Set<number>();
  return (event) => {
    if (event.event === "window-opened") {
      const { id, appId } = event.window;
      if (appId === CLIPBOARD_HELPER_APP_ID || appId === PORTAL_APP_ID) return void quiet.add(id);
      return listener();
    }
    if (event.event === "window-closed") return quiet.delete(event.id) ? undefined : listener();
    if (event.event === "space" || (event.event === "overview" && event.active)) return listener();
    if (event.event === "binding" && ["switch-next", "switch-previous", "next-window"].includes(event.name)) listener();
  };
}
