/**
 * `org.freedesktop.Notifications` at `/org/freedesktop/Notifications`, the
 * desktop notification spec (1.2), on the session bus. Apps' `Notify` calls
 * land in the store; the store's closings and invoked actions go back out as
 * `NotificationClosed` and `ActionInvoked`.
 *
 * Capabilities are what the banners do today: a body, action buttons, and
 * static icons. Markup in a body is reduced to plain text, so `body-markup`
 * is not claimed; sounds, persistence, and image data are not either.
 */

import { type ConnectOptions, DBusConnection, type InterfaceSpec, NameFlags, nameHasOwner, requestName } from "../dbus/index.ts";
import { parseNotify } from "./parse.ts";
import type { NotificationStore } from "./store.ts";
import { CloseReason } from "./types.ts";

export const SERVICE = "org.freedesktop.Notifications";
export const OBJECT_PATH = "/org/freedesktop/Notifications";

export const CAPABILITIES = ["body", "actions", "icon-static"] as const;
/** name, vendor, version, spec version */
export const SERVER_INFORMATION = ["Dashi", "Dashi", "0.1", "1.2"] as const;

export function notificationsInterface(store: NotificationStore): InterfaceSpec {
  return {
    name: SERVICE,
    methods: {
      GetCapabilities: { out: "as", handler: () => [...CAPABILITIES] },
      Notify: {
        in: "susssasa{sv}i",
        out: "u",
        handler: (args, call) => {
          const { replacesId, input } = parseNotify(args);
          return store.notify(input, replacesId, call.sender ?? "");
        },
      },
      // A notification that is already gone is not an error: the app asked for it to be gone.
      CloseNotification: {
        in: "u",
        handler: ([id]) => {
          store.close(id as number, CloseReason.closedByApp);
        },
      },
      GetServerInformation: { out: "ssss", handler: () => [...SERVER_INFORMATION] },
    },
    signals: { NotificationClosed: "uu", ActionInvoked: "us" },
  };
}

export interface NotificationsService {
  close(): void;
}

/**
 * Claim the notification name on the bus and serve it. Resolves to null, after
 * saying why, when there is no bus or another notification daemon owns the
 * name: the shell goes on without notifications.
 */
export async function serveNotifications(store: NotificationStore, options: ConnectOptions = {}): Promise<NotificationsService | null> {
  let connection: DBusConnection;
  try {
    connection = await DBusConnection.connect(options);
  } catch (error) {
    console.error("dashi-shell: notifications are off, no session bus:", error instanceof Error ? error.message : error);
    return null;
  }
  const object = connection.export(OBJECT_PATH, [notificationsInterface(store)]);
  const stopEvents = store.onEvent((event) => {
    if (connection.closed) return;
    if (event.type === "closed") object.emit(SERVICE, "NotificationClosed", event.id, event.reason);
    else object.emit(SERVICE, "ActionInvoked", event.id, event.key);
  });
  // A click in the center asks whether the app that sent a notification is still on the bus.
  store.setPresence((sender) => (sender === "" || connection.closed ? Promise.resolve(false) : nameHasOwner(connection, sender)));
  const stop = () => {
    stopEvents();
    store.setPresence(null);
    connection.close();
  };
  try {
    // Never queue: another daemon that has the name keeps it.
    const result = await requestName(connection, SERVICE, NameFlags.doNotQueue);
    if (result !== "primary" && result !== "already-owner") {
      console.error(`dashi-shell: notifications are off, ${SERVICE} is already owned on this bus`);
      stop();
      return null;
    }
  } catch (error) {
    console.error("dashi-shell: notifications are off, could not take the name:", error instanceof Error ? error.message : error);
    stop();
    return null;
  }
  connection.onClose((error) => {
    stopEvents();
    store.setPresence(null);
    if (error) console.error("dashi-shell: the notification service lost its bus connection:", error.message);
  });
  return { close: stop };
}
