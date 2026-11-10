/**
 * What a Files window holds (FilesState), what a store is started with
 * (StoreOptions) and what the store's parts (store-*.ts) ask of it.
 */

import type { SortState } from "@dashi/ui";
import type { FileItem } from "../../../../src/shared/files/items.ts";
import type { Env } from "../../env.ts";
import type { Location } from "../location.ts";
import type { Volume } from "../mounts.ts";
import type { FilesPrefs } from "../prefs.ts";
import { DEFAULT_SORT } from "../sort.ts";

export type ViewMode = "icons" | "list";
export type SearchScope = "folder" | "computer";

export interface Notice {
  id: number;
  text: string;
  error: boolean;
  /**
   * It reports a write Edit › Undo can take back: that step (the undo
   * stack's `undoStep`). The notice offers Undo, and stays, only while Undo
   * still takes back that step (operations.ts).
   */
  undoStep?: number;
}

export interface FilesState {
  location: Location;
  canBack: boolean;
  canForward: boolean;
  items: readonly FileItem[];
  loading: boolean;
  error: string | null;
  showHidden: boolean;
  view: ViewMode;
  sort: SortState;
  query: string;
  scope: SearchScope;
  /** Search results; null when not searching. */
  found: readonly FileItem[] | null;
  searching: boolean;
  truncated: boolean;
  selection: readonly string[];
  /** The item being renamed in place (F2, a new folder), or null. */
  renaming: string | null;
  /** Where `items` were listed: while a new place loads, the last one's items stay up (`stale`). */
  listed: Location;
  clipboard: { paths: readonly string[]; cut: boolean } | null;
  volumes: readonly Volume[];
  free: { free: number; total: number } | null;
  notice: Notice | null;
}

export interface StoreOptions {
  watch?: boolean;
  noticeFadeMs?: number;
  /** What may show (a chooser's filter); everything by default. Hidden files follow Show Hidden either way. */
  shows?: (item: FileItem) => boolean;
  /** What an empty listing says when the folder has items `shows` keeps out ("No folders here"); by default it is empty. */
  keptOutTitle?: string;
  /** Opening files means this here (a chooser's Open); by default each opens in its app. */
  openFiles?: (items: FileItem[]) => void;
  /** The view, sort and Show Hidden to start with, and where a change to them goes (prefs.ts); none: the defaults, kept nowhere. */
  prefs?: { read(): FilesPrefs; write(prefs: FilesPrefs): void };
}
/** How long a notice that only informs stays. */
export const NOTICE_FADE_MS = 5000;

/** What the parts of the store (search, selection, renaming, loading) use of the store they belong to. */
export interface StoreHost {
  readonly env: Env;
  getSnapshot(): FilesState;
  patch(patch: Partial<FilesState>): void;
  /** A line in the footer. */
  say(text: string, error?: boolean): void;
  /** The items as the list shows them. */
  visible(): FileItem[];
  select(paths: readonly string[]): void;
  selectedItems(): FileItem[];
  go(location: Location, options?: { record?: boolean; select?: string }): void;
  dismissNotice(): void;
}

/** A window that has just opened: loading `start`, with the view, sort and Show Hidden it kept. */
export function initialState(start: Location, prefs: FilesPrefs): FilesState {
  return {
    location: start,
    canBack: false,
    canForward: false,
    items: [],
    loading: true,
    error: null,
    showHidden: prefs.showHidden,
    view: prefs.view,
    // The default sort object itself, so Recents and the Trash keep their own order until one is picked.
    sort: prefs.sort.key === DEFAULT_SORT.key && prefs.sort.ascending === DEFAULT_SORT.ascending ? DEFAULT_SORT : prefs.sort,
    query: "",
    scope: "folder",
    found: null,
    searching: false,
    truncated: false,
    selection: [],
    renaming: null,
    listed: start,
    clipboard: null,
    volumes: [],
    free: null,
    notice: null,
  };
}
