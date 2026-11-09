/**
 * The one place graphics notices have (docs/design.html PA-16): the
 * "waiting for apps" notice, then the switch's own (notice.ts), each
 * replacing the last in the notification store, never beside it. Its
 * buttons: Quit (the apps it waits for), Keep Hybrid and Use Hybrid, and
 * Graphics Settings….
 */

import { iconPath } from "../apps.ts";
import type { NotificationStore } from "../notifications/store.ts";
import { CloseReason, type NotifyInput } from "../notifications/types.ts";
import type { GraphicsDeps } from "./controller.ts";
import { listNames } from "./policy.ts";

export interface GraphicsNoticeActions {
  /** Keep Hybrid (waiting) and Use Hybrid (after a switch to the built-in graphics). */
  keepHybrid(): void;
  /** Graphics Settings…. */
  openSettings(): void;
}

export interface GraphicsNoticePlace {
  /** What the controller says through (`GraphicsDeps`). */
  deps: Required<Pick<GraphicsDeps, "sayWaiting" | "sayChanged" | "withdrawWaiting">>;
  close(): void;
}

export function graphicsNoticePlace(notifications: NotificationStore, act: GraphicsNoticeActions): GraphicsNoticePlace {
  let id = 0;
  let quit: (() => void) | null = null;
  const post = (input: Pick<NotifyInput, "summary" | "body" | "actions">): void => {
    id = notifications.notify(
      {
        appName: "Graphics",
        // Settings' icon: the notices are the system's, and Graphics Settings… opens it.
        appIcon: iconPath("settings"),
        ...input,
        urgency: "normal",
        expireTimeout: -1,
        imagePath: "",
        desktopEntry: "",
        category: "device",
        transient: false,
        resident: false,
      },
      id,
    );
  };
  const stop = notifications.onEvent((event) => {
    if (event.type !== "action" || event.id !== id) return;
    if (event.key === "quit") quit?.();
    if (event.key === "keep" || event.key === "use-hybrid") act.keepHybrid();
    if (event.key === "settings") act.openSettings();
  });
  return {
    deps: {
      sayWaiting: (names, quitThem) => {
        quit = quitThem;
        const who = listNames(names);
        post({
          summary: "Switching to built-in graphics",
          body: `You’re on battery. ${who} ${names.length === 1 ? "is" : "are"} still using the graphics card; it switches when ${names.length === 1 ? "it quits" : "they quit"}.`,
          actions: [
            { key: "quit", label: names.length === 1 ? `Quit ${who}` : "Quit Them" },
            { key: "keep", label: "Keep Hybrid" },
          ],
        });
      },
      sayChanged: (notice) => post(notice),
      withdrawWaiting: () => {
        if (id > 0) notifications.close(id, CloseReason.closedByApp);
      },
    },
    close: stop,
  };
}
