/**
 * The Trash in the Dock (DK-4, decisions.md D802): after the last divider,
 * empty or full. Files dropped on it go to the Trash (never the home or root
 * folder, nor the folders the sidebar lists). A press opens it in Files; its menu has Open and
 * Empty Trash…, which asks first (UI-5: the person's own sheet, ume, since
 * nothing comes back). Whether it is full is the home Trash's `files`
 * folder having anything in it, watched (and read again when the watch
 * can't be had, on each open of its menu).
 */

import { type FSWatcher, watch } from "node:fs";
import { readdir } from "node:fs/promises";
import { useSyncExternalStore } from "react";

export interface TrashDeps {
  /** The home Trash's `files` folder (shared/files `trashFilesDir`). */
  folder: string;
  /** Opens Files on the Trash. */
  open(): void;
  /** Empties every Trash, once the person said yes. */
  empty(): Promise<void>;
  /** Moves these files to the Trash (those the Trash may take: `protectedReason`). */
  trash(paths: readonly string[]): Promise<void>;
  /** Asks the person; true when they said go ahead. */
  confirm(question: { title: string; detail: string; action: string; danger: boolean }): Promise<boolean>;
  /** Reads a folder's names (tests give their own). */
  list?(folder: string): Promise<readonly string[]>;
  /** Watches a folder for changes; null when it can't (tests give their own). */
  watchFolder?(folder: string, changed: () => void): { close(): void } | null;
}

/** The question Empty Trash… asks (UI-5): it can't be taken back. */
export const EMPTY_QUESTION = {
  title: "Empty the Trash?",
  detail: "Everything in the Trash is deleted for good. This can’t be undone.",
  action: "Empty Trash",
  danger: true,
} as const;

export class DockTrash {
  private full = false;
  private readonly listeners = new Set<() => void>();
  private watcher: { close(): void } | null = null;

  constructor(private readonly deps: TrashDeps) {}

  /** Starts watching the folder; reads it once now. */
  start(): this {
    const watchFolder = this.deps.watchFolder ?? watchWithNode;
    this.watcher = watchFolder(this.deps.folder, () => void this.refresh());
    void this.refresh();
    return this;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): boolean => this.full;

  /** Read the folder again: full when it holds anything. */
  async refresh(): Promise<void> {
    const list = this.deps.list ?? listWithNode;
    const names = await list(this.deps.folder).catch(() => [] as readonly string[]);
    this.set(names.length > 0);
  }

  open(): void {
    this.deps.open();
  }

  /** Files dropped on the Trash: moved there. */
  async drop(paths: readonly string[]): Promise<void> {
    if (paths.length === 0) return;
    await this.deps
      .trash(paths)
      .catch((error) => console.error("dashi-shell: the Dock's Trash could not take them:", error instanceof Error ? error.message : error));
    await this.refresh();
  }

  /** Empty Trash…: asks first; nothing happens on no. */
  async empty(): Promise<boolean> {
    if (!(await this.deps.confirm(EMPTY_QUESTION))) return false;
    await this.deps.empty();
    await this.refresh();
    return true;
  }

  close(): void {
    this.watcher?.close();
    this.watcher = null;
    this.listeners.clear();
  }

  private set(full: boolean): void {
    if (full === this.full) return;
    this.full = full;
    for (const listener of this.listeners) listener();
  }
}

async function listWithNode(folder: string): Promise<readonly string[]> {
  return await readdir(folder);
}

function watchWithNode(folder: string, changed: () => void): FSWatcher | null {
  try {
    return watch(folder, { persistent: false }, changed);
  } catch {
    // No Trash folder yet: it is empty, and the first thing trashed makes it (read again on the menu).
    return null;
  }
}

const nobody = (): (() => void) => () => {};

/** Whether the Trash is full; false without one. */
export function useTrashFull(trash: DockTrash | null): boolean {
  return useSyncExternalStore(trash?.subscribe ?? nobody, trash?.getSnapshot ?? (() => false));
}
