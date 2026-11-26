/**
 * What the Dock shows beside the apps, started with it: the badges apps send
 * over the session bus (badges.ts, DK-3) and the Trash (trash.ts, DK-4),
 * which opens in Files and asks before it is emptied.
 */

import { homedir } from "node:os";
import { launch, ownApp } from "../apps.ts";
import { filesLaunch } from "../file-manager.ts";
import { DBusConnection } from "../shared/dbus/index.ts";
import { emptyTrash, protectedReason, quietContext, trashFilesDir, trashInfoDir, trashPaths, userDirs } from "../shared/files/index.ts";
import { DockBadges } from "./badges.ts";
import { DockTrash, type TrashDeps } from "./trash.ts";

export interface DockExtras {
  badges: DockBadges;
  trash: DockTrash;
  close(): void;
}

/** Starts the badges' listener (it logs and goes on without a session bus) and the Trash's watch. */
export function startDockExtras(confirm: TrashDeps["confirm"]): DockExtras {
  const badges = new DockBadges();
  let bus: DBusConnection | null = null;
  let closed = false;
  void DBusConnection.connect()
    .then(async (connection) => {
      if (closed) return connection.close();
      bus = connection;
      await badges.listen(connection);
    })
    .catch((error) => console.error("dashi-shell: the Dock hears no badges:", error instanceof Error ? error.message : error));
  const folder = trashFilesDir();
  const trash = new DockTrash({
    folder,
    confirm,
    open: () => {
      const files = filesLaunch(ownApp("dev.dashi.files"), [folder], "");
      if (files) launch(files);
    },
    empty: () => emptyTrash({ files: folder, info: trashInfoDir() }),
    trash: async (paths) => {
      const kept = userDirs().map((dir) => dir.path);
      await trashPaths(
        paths.filter((path) => protectedReason(path, homedir(), kept) === null),
        quietContext(),
      );
    },
  }).start();
  return {
    badges,
    trash,
    close() {
      closed = true;
      badges.close();
      trash.close();
      bus?.close();
    },
  };
}
