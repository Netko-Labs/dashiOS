/**
 * The system tray: StatusNotifierItems in the menu bar's extras. One session
 * bus connection serves the watcher (or follows another program's), owns
 * `org.kde.StatusNotifierHost-<pid>` as hosts do, follows NameOwnerChanged to
 * drop items whose app left, and hosts every item (host.ts). Optional like
 * the shell's other bus services: with no session bus there is no tray.
 */

import type { ExtrasStore } from "../extras/store.ts";
import { BUS_NAME, BUS_PATH, type ConnectOptions, DBusConnection, NameFlags, requestName } from "../shared/dbus/index.ts";
import { nameGone } from "./address.ts";
import { TrayHost } from "./host.ts";
import { type TrayIconOptions, TrayIcons } from "./icon.ts";
import { followWatcher, serveWatcher, WATCHER, type WatcherFollower, type WatcherService } from "./watcher.ts";

export interface TrayOptions {
  bus?: ConnectOptions;
  icons?: TrayIconOptions;
}

export interface Tray {
  close(): void;
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Start the tray: tray items appear in `extras` (source `tray`) as apps
 * register them. Resolves to null, after saying why, when there is no session
 * bus.
 */
export async function startTray(extras: ExtrasStore, options: TrayOptions = {}): Promise<Tray | null> {
  let connection: DBusConnection;
  try {
    connection = await DBusConnection.connect(options.bus);
  } catch (error) {
    console.error(`dashi-shell: the tray is off, no session bus: ${message(error)}`);
    return null;
  }
  const icons = new TrayIcons(options.icons);
  const host = new TrayHost(connection, extras, icons);
  const hostName = `org.kde.StatusNotifierHost-${process.pid}`;
  let watcher: WatcherService | null = null;
  let follower: WatcherFollower | null = null;
  let closed = false;

  // Serve the watcher if the name is free, else follow whoever has it.
  const findWatcher = async (): Promise<void> => {
    watcher = await serveWatcher(connection, host);
    if (watcher) {
      // Ours now: what it says, the host hears directly.
      follower?.close();
      follower = null;
      return;
    }
    if (!closed) follower ??= await followWatcher(connection, host, hostName);
  };

  const stopOwners = await connection.subscribe(
    { type: "signal", sender: BUS_NAME, interface: BUS_NAME, member: "NameOwnerChanged", path: BUS_PATH },
    (changed) => {
      const [name, , next] = changed.body;
      if (name === WATCHER && !watcher && follower) {
        // The watcher we follow went away or changed hands: its items are not ours to keep.
        host.clear();
        if (next === "") void findWatcher().catch((error: unknown) => console.error(`dashi-shell: tray: ${message(error)}`));
        else if (next !== connection.uniqueName) void follower.reload();
      }
      const gone = nameGone(changed.body);
      if (gone === null) return;
      watcher?.ownerGone(gone);
      host.ownerGone(gone);
    },
  );

  const close = (): void => {
    if (closed) return;
    closed = true;
    void stopOwners().catch(() => {});
    watcher?.close();
    follower?.close();
    host.clear();
    icons.close();
    connection.close();
  };

  try {
    // Hosts own this name by convention; nothing depends on having it.
    await requestName(connection, hostName, NameFlags.doNotQueue).catch(() => "exists");
    await findWatcher();
  } catch (error) {
    console.error(`dashi-shell: the tray is off: ${message(error)}`);
    close();
    return null;
  }
  connection.onClose((error) => {
    if (closed) return;
    // The bus went away: every tray extra goes with it.
    closed = true;
    host.clear();
    icons.close();
    if (error) console.error(`dashi-shell: the tray lost its bus connection: ${error.message}`);
  });
  return { close };
}
