/**
 * "Add to Dock" for web apps (the portal's DynamicLauncher): once the person
 * says Add, xdg-desktop-portal writes the app's launcher itself, into
 * `$XDG_DATA_HOME/xdg-desktop-portal/applications/` with a link in
 * `$XDG_DATA_HOME/applications/`, named `<app id>.<the app's own id>.desktop`.
 * The shell watches that folder for a while and pins the new launcher in the
 * Dock when it appears. Removing it is removing the app, as for any other.
 */

import { readdirSync, watch } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** How long after Add the launcher may take to appear. */
const WAIT_MS = 2 * 60 * 1000;

export function applicationsDir(env: Record<string, string | undefined> = process.env, home: string = homedir()): string {
  return join(env.XDG_DATA_HOME || join(home, ".local", "share"), "applications");
}

const desktopFiles = (dir: string): string[] => {
  try {
    return readdirSync(dir).filter((file) => file.endsWith(".desktop"));
  } catch {
    return [];
  }
};

/**
 * The desktop id of a launcher that is new since `before`: one whose name the
 * portal gives it (`<app id>.…`), or, for an app with no id, any new one. Null
 * while there is none.
 */
export function newLauncher(files: readonly string[], before: ReadonlySet<string>, appId: string): string | null {
  const found = files.find((file) => !before.has(file) && file.endsWith(".desktop") && (appId === "" || file.startsWith(`${appId}.`)));
  return found ? found.slice(0, -".desktop".length) : null;
}

/** Watches for the launcher `appId` installs next and hands its desktop id to `pin`; returns a stop function. */
export function pinNextLauncher(appId: string, pin: (desktopId: string) => void, dir: string = applicationsDir()): () => void {
  const before = new Set(desktopFiles(dir));
  let done = false;
  let watcher: ReturnType<typeof watch> | null = null;
  const stop = () => {
    done = true;
    clearTimeout(timer);
    watcher?.close();
  };
  const look = () => {
    if (done) return;
    const id = newLauncher(desktopFiles(dir), before, appId);
    if (id === null) return;
    stop();
    pin(id);
  };
  const timer = setTimeout(stop, WAIT_MS);
  try {
    watcher = watch(dir, () => look());
  } catch {
    // No folder yet: look now and then instead.
    const poll = setInterval(() => (done ? clearInterval(poll) : look()), 1000);
  }
  return stop;
}
