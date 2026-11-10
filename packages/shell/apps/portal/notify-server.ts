/**
 * The notification server the portal's notifications go to: Dashi's own,
 * org.freedesktop.Notifications in the shell (src/notifications/server.ts),
 * and the signals it sends back about them.
 */

import type { DBusConnection } from "../../src/shared/dbus/index.ts";
import type { NotificationBackend, NotificationServer } from "./notification.ts";

const SERVICE = "org.freedesktop.Notifications";
const PATH = "/org/freedesktop/Notifications";

export function freedesktopServer(bus: () => Promise<DBusConnection>): NotificationServer {
  return {
    async notify(appName, replaces, icon, call) {
      const connection = await bus();
      const [id] = await connection.call({
        destination: SERVICE,
        path: PATH,
        interface: SERVICE,
        member: "Notify",
        signature: "susssasa{sv}i",
        body: [appName, replaces, icon, call.summary, call.body, call.actions, call.hints, -1],
      });
      if (typeof id !== "number") throw new Error("Notify answered without an id");
      return id;
    },
    async close(id) {
      const connection = await bus();
      await connection.call({ destination: SERVICE, path: PATH, interface: SERVICE, member: "CloseNotification", signature: "u", body: [id] });
    },
  };
}

/** Hands the server's ActionInvoked and NotificationClosed to the backend. */
export async function followServer(connection: DBusConnection, backend: NotificationBackend): Promise<void> {
  await connection.subscribe({ type: "signal", sender: SERVICE, interface: SERVICE, member: "ActionInvoked", path: PATH }, (message) => {
    const [id, key] = message.body;
    if (typeof id === "number" && typeof key === "string") backend.actionInvoked(id, key);
  });
  await connection.subscribe({ type: "signal", sender: SERVICE, interface: SERVICE, member: "NotificationClosed", path: PATH }, (message) => {
    const [id] = message.body;
    if (typeof id === "number") backend.closed(id);
  });
}
