/** The store and operations a Files window's views share. */

import { createContext, useContext, useSyncExternalStore } from "react";
import type { Operations } from "./operations.ts";
import type { FilesState, FilesStore } from "./store.ts";
import type { Job } from "./jobs.ts";

export interface FilesContext {
  store: FilesStore;
  ops: Operations;
  /** Window-level things the views ask for: sheets and menus live in the window. */
  actions: WindowActions;
}

export interface WindowActions {
  rename(path: string): void;
  info(path: string): void;
  openWith(path: string): void;
  newFolder(): void;
  goToFolder(): void;
  confirmEmptyTrash(): void;
  confirmDelete(paths: readonly string[]): void;
  menu(point: { x: number; y: number }, kind: "item" | "background"): void;
  /** Give the keyboard back to the window's key sink (after a click on an item). */
  refocus(): void;
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

export function useJobs(): readonly Job[] {
  const { ops } = useFiles();
  return useSyncExternalStore(ops.jobs.subscribe, ops.jobs.getSnapshot);
}
