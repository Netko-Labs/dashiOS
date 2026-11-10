/**
 * Notifications for the shell: the store, the D-Bus server that fills it, the
 * banners that show it, and the notification center that lists the history
 * (opened from the menu bar's clock, menus/). `startNotifications` wires the
 * server and the banners and hands back the store.
 */

import { spawnShellHost } from "../metal-host.ts";
import { mayServeNotifications } from "../system/stand-in.ts";
import { serveNotifications } from "./server.ts";
import { BannerStack } from "./stack.tsx";
import { NotificationStore } from "./store.ts";

export interface Notifications {
  store: NotificationStore;
  close(): void;
}

export interface NotificationsOptions {
  /** Whether the shell may take the notification name on the session bus; defaults to the development-run gate (system/stand-in.ts). */
  serve?: boolean;
  /** The screen banners appear on, asked when the first of a run of banners arrives; the compositor's choice without it. */
  screen?: () => Promise<string | undefined>;
}

export function startNotifications(store = new NotificationStore(), options: NotificationsOptions = {}): Notifications {
  const stack = new BannerStack(store, (options) => spawnShellHost(options), undefined, options.screen);
  const stopBanners = stack.start();
  let service: { close(): void } | null = null;
  let closed = false;
  // A development run does not take the name on the developer's own bus (their notifications
  // would land in a window of ours). The banners still show what the shell itself posts.
  if (options.serve ?? mayServeNotifications(process.env)) {
    // The bus may be slow or absent; the shell doesn't wait for it.
    serveNotifications(store)
      .then((started) => {
        if (closed) started?.close();
        else service = started;
      })
      .catch((error) => console.error("dashi-shell: notifications are off:", error));
  } else {
    console.error(
      "dashi-shell: not serving org.freedesktop.Notifications (this is a development run; DASHI_NOTIFICATIONS=1 serves it on the bus you point DBUS_SESSION_BUS_ADDRESS at)",
    );
  }
  return {
    store,
    close() {
      closed = true;
      service?.close();
      stopBanners();
    },
  };
}
