/**
 * The launcher's app index, built once and kept: a ❖ tap reads it from
 * memory and never the disk. It is built in the background at startup and
 * again when an applications directory changes (inotify, through `fs.watch`):
 * an app installed or removed shows up on the next tap. An applications
 * directory is watched with its subfolders (Wine installs programs' entries
 * in `wine/Programs/`). A directory that doesn't exist yet (a fresh home's
 * ~/.local/share/applications) is watched through the nearest folder above
 * it that does, alone, so its creation counts too.
 */

import { existsSync, type FSWatcher, watch as fsWatch } from "node:fs";
import { dirname, join } from "node:path";
import { dataDirs, type Entry, loadEntries } from "../entries.ts";

/** Changes come in bursts (a package installs a dozen files); one rebuild after the burst. */
export const SETTLE_MS = 250;

export interface AppIndexOptions {
  /** Builds the index (entries.ts `loadEntries`). */
  load?: () => Entry[];
  /** The folders whose changes rebuild it: every XDG data dir's `applications`. */
  dirs?: () => string[];
  /** `fs.watch`, with the subfolders when `recursive` (an applications directory), or a stand-in in tests. */
  watch?: (path: string, listener: () => void, recursive: boolean) => Pick<FSWatcher, "close">;
  exists?: (path: string) => boolean;
  /** Timers, or a stand-in in tests. */
  schedule?: (run: () => void, ms: number) => () => void;
}

export class AppIndex {
  private current: Entry[] | null = null;
  private watchers: Array<Pick<FSWatcher, "close">> = [];
  private cancelPending: (() => void) | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly load: () => Entry[];
  private readonly dirs: () => string[];
  private readonly watchPath: NonNullable<AppIndexOptions["watch"]>;
  private readonly exists: (path: string) => boolean;
  private readonly schedule: NonNullable<AppIndexOptions["schedule"]>;

  constructor(options: AppIndexOptions = {}) {
    this.load = options.load ?? (() => loadEntries());
    this.dirs = options.dirs ?? (() => dataDirs().map((dir) => join(dir, "applications")));
    this.watchPath = options.watch ?? ((path, listener, recursive) => fsWatch(path, { persistent: false, recursive }, listener));
    this.exists = options.exists ?? existsSync;
    this.schedule =
      options.schedule ??
      ((run, ms) => {
        const timer = setTimeout(run, ms);
        return () => clearTimeout(timer);
      });
  }

  /** Builds the index soon (off the path of whatever is starting) and starts watching. */
  start(): () => void {
    this.arm();
    this.refreshSoon(0);
    return () => this.stop();
  }

  /** The apps, as last built; built right now only if nothing has been yet. */
  entries(): readonly Entry[] {
    this.current ??= this.load();
    return this.current;
  }

  /** Whether the index has been built (a tap before that builds it on the spot). */
  isReady(): boolean {
    return this.current !== null;
  }

  /** Hears every rebuild. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Rebuild after `ms` (the shell registered something new, or a directory changed). */
  refreshSoon(ms = SETTLE_MS): void {
    this.cancelPending?.();
    this.cancelPending = this.schedule(() => {
      this.cancelPending = null;
      this.rebuild();
    }, ms);
  }

  stop(): void {
    this.cancelPending?.();
    this.cancelPending = null;
    for (const watcher of this.watchers) watcher.close();
    this.watchers = [];
  }

  private rebuild(): void {
    try {
      this.current = this.load();
    } catch (error) {
      // The last good index stays.
      console.error("dashi-shell: could not read the installed apps:", error instanceof Error ? error.message : error);
      return;
    }
    // A directory that appeared is watched itself from now on.
    this.arm();
    for (const listener of this.listeners) listener();
  }

  /** Watch each directory, or the nearest existing folder above one that is missing. */
  private arm(): void {
    for (const watcher of this.watchers) watcher.close();
    this.watchers = [];
    // Each folder to watch, and whether it is an applications directory itself (watched with its subfolders).
    const targets = new Map<string, boolean>();
    for (const dir of this.dirs()) {
      const at = nearestExisting(dir, this.exists);
      if (at !== null) targets.set(at, (targets.get(at) ?? false) || at === dir);
    }
    for (const [path, recursive] of targets) {
      try {
        this.watchers.push(this.watchPath(path, () => this.refreshSoon(), recursive));
      } catch (error) {
        console.error(`dashi-shell: cannot watch ${path} for new apps:`, error instanceof Error ? error.message : error);
      }
    }
  }
}

/** `path`, or the closest folder above it that exists; null when not even `/` does (it always does). */
export function nearestExisting(path: string, exists: (path: string) => boolean): string | null {
  let at = path;
  while (!exists(at)) {
    const up = dirname(at);
    if (up === at) return null;
    at = up;
  }
  return at;
}
