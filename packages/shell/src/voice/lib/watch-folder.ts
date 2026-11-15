/**
 * Told when anything in a folder changes, its sub-folders included (the
 * models' folder: one folder a set, models.ts `watch`). A folder that is
 * not there yet (no model was ever fetched) is waited for from the nearest
 * folder above it that is. A folder that cannot be watched is not, quietly:
 * the pane still looks when it opens.
 */

import { existsSync, type FSWatcher, watch } from "node:fs";
import { dirname } from "node:path";

/** What watches a folder: `changed` on any change in it; it gives back how to stop. */
export type FolderWatch = (folder: string, changed: () => void) => () => void;

export const watchFolder: FolderWatch = (folder, changed) => {
  let watcher: FSWatcher | null = null;
  let stopped = false;
  const arm = (): void => {
    watcher?.close();
    watcher = null;
    let dir = folder;
    while (!existsSync(dir) && dirname(dir) !== dir) dir = dirname(dir);
    const whole = dir === folder;
    try {
      watcher = watch(dir, { recursive: whole }, () => {
        if (stopped) return;
        changed();
        // The folder itself came to be: watch it, and what is under it.
        if (!whole && existsSync(folder)) arm();
      });
      watcher.on("error", () => {});
    } catch {
      watcher = null;
    }
  };
  arm();
  return () => {
    stopped = true;
    watcher?.close();
  };
};
