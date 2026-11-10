/** The apps' permissions from login: the permission store on the session bus, followed, and its grants dated (store.ts). */

import { DBusConnection } from "../shared/dbus/index.ts";
import { PermissionStore } from "./lib/permission-store.ts";
import { SeenTimes } from "./lib/seen.ts";
import { PrivacyStore } from "./store.ts";

export interface Privacy {
  store: PrivacyStore;
  stop(): void;
}

export function startPrivacy(): Privacy {
  let connection: Promise<DBusConnection> | null = null;
  const bus = (): Promise<DBusConnection> =>
    (connection ??= DBusConnection.connect({ bus: "session" }).then(
      (made) => {
        made.onClose(() => {
          connection = null;
        });
        return made;
      },
      (error: unknown) => {
        connection = null;
        throw error;
      },
    ));
  const store = new PrivacyStore(new PermissionStore(bus), new SeenTimes());
  const stopStore = store.start();
  return {
    store,
    stop() {
      stopStore();
      void connection?.then((made) => made.close()).catch(() => {});
    },
  };
}
