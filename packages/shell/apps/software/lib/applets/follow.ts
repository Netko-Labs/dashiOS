/**
 * The open Store follows the applets folder: an add-on the launcher got, or
 * one removed by `dashi-applet` or another Store window, shows (or leaves)
 * Installed without reopening (pass 37). The folder is watched with its
 * subfolders, as the shell's applet runner watches it (src/applets/launcher.ts),
 * and a burst of writes (an install unpacks, then renames) is one look.
 */

import { mkdirSync, watch } from "node:fs";

/** An install writes several files and renames a folder: wait for the dust to settle. */
export const SETTLE_MS = 300;

export interface FollowDeps {
  /** fs.watch, recursive; tests pass their own. */
  watch?: (root: string, changed: () => void) => { close(): void };
  /** setTimeout and clearTimeout; tests pass their own. */
  later?: (run: () => void, ms: number) => () => void;
}

const watchFolder = (root: string, changed: () => void): { close(): void } => {
  mkdirSync(root, { recursive: true });
  const watcher = watch(root, { recursive: true }, () => changed());
  watcher.on("error", () => {});
  return watcher;
};

const realLater = (run: () => void, ms: number): (() => void) => {
  const timer = setTimeout(run, ms);
  return () => clearTimeout(timer);
};

/** Calls `onChange` once things settle after anything under `root` changes; returns what stops it. */
export function followFolder(root: string, onChange: () => void, deps: FollowDeps = {}): () => void {
  const later = deps.later ?? realLater;
  let cancel: (() => void) | null = null;
  let stopped = false;
  const changed = (): void => {
    if (stopped) return;
    cancel?.();
    cancel = later(() => {
      cancel = null;
      if (!stopped) onChange();
    }, SETTLE_MS);
  };
  let watcher: { close(): void } | null = null;
  try {
    watcher = (deps.watch ?? watchFolder)(root, changed);
  } catch {
    // No folder to watch (and none could be made): Installed is read when the window opens, as before.
  }
  return () => {
    stopped = true;
    cancel?.();
    watcher?.close();
  };
}
