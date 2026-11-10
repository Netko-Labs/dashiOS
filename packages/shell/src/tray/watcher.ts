/**
 * `org.kde.StatusNotifierWatcher` at `/StatusNotifierWatcher`: the list of
 * tray items apps register with, and the signals hosts follow. The shell
 * serves it when the name is free; when another watcher already has it (a
 * stand-alone one, or a desktop the shell runs inside), the shell follows
 * that one instead, as any other host would.
 *
 * Items whose owner leaves the bus are dropped (`ownerGone`, from the
 * NameOwnerChanged the tray already follows).
 */

import { readFileSync } from "node:fs";
import {
  BUS_NAME,
  BUS_PATH,
  type DBusConnection,
  DBusError,
  ERRORS,
  type ExportedObject,
  getNameOwner,
  type InterfaceSpec,
  NameFlags,
  nameHasOwner,
  requestName,
  unwrap,
} from "../shared/dbus/index.ts";
import { type ItemAddress, ItemRegistry, itemId, parseItemId, parseRegistration } from "./address.ts";

export const WATCHER = "org.kde.StatusNotifierWatcher";
export const WATCHER_PATH = "/StatusNotifierWatcher";
const PROPERTIES = "org.freedesktop.DBus.Properties";

/** What a watcher, ours or another's, reports to the host. */
export interface ItemEvents {
  /** An item registered (again, if already known: it may have new properties). */
  registered(address: ItemAddress): void;
  unregistered(id: string): void;
}

export interface WatcherService {
  /** `name` left the bus: its items are unregistered. */
  ownerGone(name: string): void;
  close(): void;
}

function watcherInterface(connection: DBusConnection, registry: ItemRegistry, events: ItemEvents, object: () => ExportedObject | null): InterfaceSpec {
  return {
    name: WATCHER,
    methods: {
      RegisterStatusNotifierItem: {
        in: "s",
        handler: async ([arg], call) => {
          const address = parseRegistration(arg, call.sender);
          if (!address) throw new DBusError(ERRORS.invalidArgs, "the argument is neither a bus name nor an object path");
          // A name nobody owns would never leave the bus, so its item would never go.
          if (address.bus !== call.sender && !(await nameHasOwner(connection, address.bus))) {
            throw new DBusError(ERRORS.invalidArgs, `${address.bus} is not on the bus`);
          }
          const result = registry.add(address);
          if (result === "full") throw new DBusError(ERRORS.limitsExceeded, "too many tray items");
          if (result === "added") {
            object()?.emit(WATCHER, "StatusNotifierItemRegistered", itemId(address));
            object()?.propertiesChanged(WATCHER, ["RegisteredStatusNotifierItems"]);
          }
          events.registered(address);
        },
      },
      // The shell is the host; other hosts are welcome and told they are seen.
      RegisterStatusNotifierHost: {
        in: "s",
        handler: () => {
          object()?.emit(WATCHER, "StatusNotifierHostRegistered");
        },
      },
    },
    signals: { StatusNotifierItemRegistered: "s", StatusNotifierItemUnregistered: "s", StatusNotifierHostRegistered: "" },
    properties: {
      RegisteredStatusNotifierItems: { type: "as", get: () => registry.ids() },
      IsStatusNotifierHostRegistered: { type: "b", get: () => true },
      ProtocolVersion: { type: "i", get: () => 0 },
    },
  };
}

/** Who holds `name`, for the message that says the shell is not the watcher. */
async function describeOwner(connection: DBusConnection, name: string): Promise<string> {
  try {
    const owner = await getNameOwner(connection, name);
    const [pid] = await connection.call({
      destination: BUS_NAME,
      path: BUS_PATH,
      interface: BUS_NAME,
      member: "GetConnectionUnixProcessID",
      signature: "s",
      body: [owner],
    });
    if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) return owner;
    const command = readFileSync(`/proc/${pid}/comm`, "utf8").trim();
    return `${owner} (${command || "pid"} ${pid})`;
  } catch {
    return "another program";
  }
}

/**
 * Serve the watcher on `connection`. Resolves to null, after saying why on
 * stderr, when another program owns the name.
 */
export async function serveWatcher(connection: DBusConnection, events: ItemEvents): Promise<WatcherService | null> {
  const registry = new ItemRegistry();
  // The interface emits through the object that exports it; calls only arrive once it is exported.
  let served: ExportedObject | null = null;
  const object = connection.export(WATCHER_PATH, [watcherInterface(connection, registry, events, () => served)]);
  served = object;
  // Never queue: a watcher that has the name keeps it, and the shell follows it.
  const result = await requestName(connection, WATCHER, NameFlags.doNotQueue).catch((error: unknown) => {
    console.error(`dashi-shell: tray: could not ask for ${WATCHER}: ${error instanceof Error ? error.message : String(error)}`);
    return "exists" as const;
  });
  if (result !== "primary" && result !== "already-owner") {
    object.unexport();
    console.error(`dashi-shell: tray: ${WATCHER} is owned by ${await describeOwner(connection, WATCHER)}; following it as a host`);
    return null;
  }
  return {
    ownerGone(name) {
      const gone = registry.ownerGone(name);
      for (const address of gone) {
        const id = itemId(address);
        if (!connection.closed) object.emit(WATCHER, "StatusNotifierItemUnregistered", id);
        events.unregistered(id);
      }
      if (gone.length > 0 && !connection.closed) object.propertiesChanged(WATCHER, ["RegisteredStatusNotifierItems"]);
    },
    close() {
      object.unexport();
    },
  };
}

export interface WatcherFollower {
  /** Read the items again and register as a host again (the watcher changed hands). */
  reload(): Promise<void>;
  close(): void;
}

/** Follow the watcher another program serves, registered with it as `hostName`. */
export async function followWatcher(connection: DBusConnection, events: ItemEvents, hostName: string): Promise<WatcherFollower> {
  const watcher = { destination: WATCHER, path: WATCHER_PATH } as const;
  const stops = await Promise.all([
    connection.subscribe({ type: "signal", sender: WATCHER, interface: WATCHER, member: "StatusNotifierItemRegistered" }, (message) => {
      const address = parseItemId(message.body[0]);
      if (address) events.registered(address);
    }),
    connection.subscribe({ type: "signal", sender: WATCHER, interface: WATCHER, member: "StatusNotifierItemUnregistered" }, (message) => {
      const address = parseItemId(message.body[0]);
      if (address) events.unregistered(itemId(address));
    }),
  ]);
  const reload = async (): Promise<void> => {
    try {
      await connection.call({ ...watcher, interface: WATCHER, member: "RegisterStatusNotifierHost", signature: "s", body: [hostName] });
      const [value] = await connection.call({
        ...watcher,
        interface: PROPERTIES,
        member: "Get",
        signature: "ss",
        body: [WATCHER, "RegisteredStatusNotifierItems"],
      });
      const ids = unwrap(value);
      for (const id of Array.isArray(ids) ? ids : []) {
        const address = parseItemId(id);
        if (address) events.registered(address);
      }
    } catch (error) {
      console.error(`dashi-shell: tray: the watcher did not answer: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  await reload();
  return {
    reload,
    close() {
      for (const stop of stops) void stop().catch(() => {});
    },
  };
}
