/**
 * Picks up what happens in the notes folder while the app is open: another
 * editor saving a file, a sync tool dropping one in, an agent appending to a
 * note. `fs.watch` on the root and on each folder in it (folders are one level
 * deep, so no recursive watch is needed); a burst of events becomes one
 * `onChange` after a short quiet. Folders that come and go are picked up by
 * the root's own events.
 */

import { type FSWatcher, readdirSync, watch } from "node:fs";
import { join } from "node:path";

export const QUIET_MS = 150;

/** The directories to watch for `root`: itself, its folders, and Recently Deleted. */
function directories(root: string): string[] {
  try {
    const folders = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && (!entry.name.startsWith(".") || entry.name === ".Recently Deleted"))
      .map((entry) => join(root, entry.name));
    return [root, ...folders];
  } catch {
    return [root];
  }
}

/** Calls `onChange` (after a quiet moment) when anything under `root` changes; returns the function that stops watching. */
export function watchNotes(root: string, onChange: () => void, quietMs = QUIET_MS): () => void {
  const watchers = new Map<string, FSWatcher>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const sync = (): void => {
    const wanted = new Set(directories(root));
    for (const [path, watcher] of watchers) {
      if (wanted.has(path)) continue;
      watcher.close();
      watchers.delete(path);
    }
    for (const path of wanted) {
      if (watchers.has(path)) continue;
      try {
        const watcher = watch(path, schedule);
        // A watched folder that is deleted ends its watcher with an error event; the root's event re-syncs.
        watcher.on("error", () => schedule());
        watchers.set(path, watcher);
      } catch {
        // Gone before it could be watched.
      }
    }
  };

  function schedule(): void {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (stopped) return;
      sync();
      onChange();
    }, quietMs);
  }

  sync();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    for (const watcher of watchers.values()) watcher.close();
    watchers.clear();
  };
}
