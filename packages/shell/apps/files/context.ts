/** The store and operations a browser's views share: Files' window, or a chooser (which writes nothing but a new folder, and has no ops). */

import { createContext, useContext, useSyncExternalStore } from "react";
import type { Job } from "./jobs.ts";
import type { Operations } from "./operations.ts";
import type { FilesState, FilesStore } from "./store.ts";

export interface FilesContext {
  store: FilesStore;
  /** What writes: Files' own; null in a chooser, whose views then take no drops and show no Trash. */
  ops: Operations | null;
  /** Window-level things the views ask for: sheets and menus live in the window. */
  actions: WindowActions;
}

export interface WindowActions {
  rename(path: string): void;
  info(path: string): void;
  openWith(path: string): void;
  newFolder(): void;
  /** The omnibox, editing the current folder's path. */
  goToFolder(): void;
  /** The omnibox, empty, for a search. */
  find(): void;
  confirmEmptyTrash(): void;
  confirmDelete(paths: readonly string[]): void;
  menu(point: { x: number; y: number }, kind: "item" | "background"): void;
  /** Give the keyboard back to the window's keys (after a click on an item, or a field let go). */
  refocus(): void;
}

/** Actions for a browser that has no sheets or menus of its own (a chooser): only the keyboard comes back. */
export function quietActions(refocus: () => void): WindowActions {
  const nothing = (): void => {};
  return {
    rename: nothing,
    info: nothing,
    openWith: nothing,
    newFolder: nothing,
    goToFolder: nothing,
    find: nothing,
    confirmEmptyTrash: nothing,
    confirmDelete: nothing,
    menu: nothing,
    refocus,
  };
}

export const Files = createContext<FilesContext | null>(null);

export function useFiles(): FilesContext {
  const value = useContext(Files);
  if (!value) throw new Error("useFiles outside a Files window");
  return value;
}

export function useFilesState(): FilesState {
  const { store } = useFiles();
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

/** Files' own context, with its operations: the footer, the toolbar, the menus. */
export function useFilesOps(): Operations {
  const { ops } = useFiles();
  if (!ops) throw new Error("Files' operations outside Files' window");
  return ops;
}

export function useJobs(): readonly Job[] {
  const ops = useFilesOps();
  return useSyncExternalStore(ops.jobs.subscribe, ops.jobs.getSnapshot);
}
