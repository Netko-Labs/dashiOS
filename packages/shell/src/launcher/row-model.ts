/**
 * One launcher row as data, and the rows made from what the ranking found:
 * an app (with its windows), a Settings pane, a setting with its control, a
 * window, one of Dashi's commands, an app's menu item, a file. Each says on
 * one line what it is (VS-2): the title, a few muted words, and at the right
 * its kind, or the key that does it, or its control.
 */

import type { ActionState } from "../actions/types.ts";
import type { Entry } from "../entries.ts";
import type { FileHit } from "../file-search.ts";
import { PANES } from "../settings-app/panes.ts";
import { isPane, type LauncherItem, type LauncherWindow } from "./items.ts";
import { prepare } from "./ranking/fold.ts";

/** A file row: its hit and the icon resolved for it. */
export interface FileRow extends FileHit {
  icon: string;
}

/** An image file, a one-color glyph drawn on a neutral tile, or none (a verb of the action list). */
export type RowIcon = { image: string } | { glyph: string } | { none: true };

/** What Enter does on a row (verbs.ts adds what the action list and the other keys do). */
export type RowAction =
  | { kind: "open"; entry: Entry }
  /** Bring this window forward (an app with windows switches to its last one). */
  | { kind: "focus"; window: LauncherWindow }
  /** Run a registry action as the person. */
  | { kind: "run"; item: LauncherItem }
  /** Open System Settings at a setting's row. */
  | { kind: "reveal"; item: LauncherItem }
  | { kind: "open-file"; file: FileRow }
  | { kind: "copy"; text: string }
  /** Put these words in the field (the examples of the empty launcher). */
  | { kind: "type"; query: string }
  | { kind: "search-files"; query: string }
  | { kind: "find-software"; query: string }
  | { kind: "all-apps" };

/** The section a row goes under once two kinds show. */
export type RowGroup = "answer" | "window" | "app" | "settings" | "command" | "menu" | "file" | "other";

/** A setting's state, drawn in the row: a switch Space flips, or the value it has. */
export type RowControl = { kind: "switch"; on: boolean } | { kind: "value"; text: string };

export interface Row {
  id: string;
  title: string;
  /** A few muted words after the title, on the same line. */
  detail?: string;
  /** What it is, right-aligned and muted ("App", "Settings"); empty for nothing. */
  kind: string;
  icon: RowIcon;
  action: RowAction;
  group?: RowGroup;
  /** What it was found as: the action list is the item's. */
  item?: LauncherItem;
  /** The key that does it, at the right in place of the kind ("⇧❖N"), so choosing it teaches the key. */
  shortcut?: string;
  control?: RowControl;
  /** Keys drawn as glyphs after the title (a shortcut being set): fonts may not have ❖. */
  chord?: string;
  /** The person's alias for it, a small badge after the title. */
  badge?: string;
  /** The title in SemiBold (the answer). */
  strong?: true;
  /** It closes or destroys something: the title is drawn in the critical color. */
  danger?: true;
  /** A → at the right end: Enter goes somewhere in the launcher (All apps). */
  more?: true;
}

const kindOf = (entry: Entry): string => (isPane(entry) ? "Settings" : "App");
export const iconOf = (entry: Entry): RowIcon => (entry.glyph ? { glyph: entry.glyph } : { image: entry.icon });

/** The name the person reads: their language's (Name[de]) when the entry has one. */
export const shownName = (entry: Entry): string => entry.localized?.name || entry.name;

/** "2 windows", "minimized". */
function windowCount(windows: readonly LauncherWindow[]): string {
  return windows.length === 1 ? "1 window" : `${windows.length} windows`;
}

/** An app or a pane; an app with windows open says how many, and Enter switches to its last one. */
export function entryRow(entry: Entry, prefix = "entry", windows: readonly LauncherWindow[] = []): Row {
  const [front] = windows;
  const detail = front ? windowCount(windows) : entry.detail;
  return {
    id: `${prefix}:${entry.id}`,
    title: shownName(entry),
    ...(detail ? { detail } : {}),
    kind: kindOf(entry),
    icon: iconOf(entry),
    action: front ? { kind: "focus", window: front } : { kind: "open", entry },
    group: isPane(entry) ? "settings" : "app",
  };
}

/**
 * Whether a file's name answers `query` as a name would: every word typed
 * starts a word of the name ("set" is not "sunset.png"; "tea no" is
 * "tea-notes.md"). LocalSearch matches inside words; the rows don't.
 */
export function fileNameMatches(name: string, query: string): boolean {
  const words = prepare(name).words;
  const typed = prepare(query).words;
  return typed.length > 0 && typed.every((word) => words.some((each) => each.startsWith(word)));
}

/** A folder as a row says it: its last part, with where it starts ("~/…/drafts"); a short one whole. */
export function shortFolder(folder: string): string {
  const parts = folder.split("/");
  if (parts.length <= 3) return folder;
  return `${parts[0] === "" ? "" : parts[0]}/…/${parts.at(-1)}`;
}

export function fileRow(file: FileRow): Row {
  const folder = file.mime === "inode/directory";
  return {
    id: `file:${file.url}`,
    title: file.name,
    detail: shortFolder(file.folder),
    kind: folder ? "Folder" : "File",
    icon: { image: file.icon },
    action: { kind: "open-file", file },
    group: "file",
  };
}

/** Where a window is, when that is worth a word: minimized, hidden, or on another Desktop. */
function whereIs(window: LauncherWindow): string | null {
  if (window.state === "minimized") return "minimized";
  if (window.state === "hidden") return "hidden";
  return window.desktop ?? null;
}

export function windowRow(window: LauncherWindow): Row {
  const where = whereIs(window);
  return {
    id: `window:${window.id}`,
    title: window.title.trim() || window.appName,
    detail: where ? `${window.appName} · ${where}` : window.appName,
    kind: "Window",
    icon: { image: window.icon },
    action: { kind: "focus", window },
    group: "window",
  };
}

/** A toggle's or a pick's state as the row draws it; null when it has none here (no Dock, no Wi-Fi). */
export function controlFor(state: ActionState | undefined): RowControl | null {
  if (typeof state === "boolean") return { kind: "switch", on: state };
  if (typeof state === "string" && state !== "") return { kind: "value", text: state };
  if (typeof state === "number") return { kind: "value", text: `${Math.round(state * 100) / 100}×` };
  return null;
}

const PANE_TITLES = new Map(PANES.map((pane) => [pane.id as string, pane]));

/** A registry action's row: a setting (with its control), a command, a menu item. */
export function actionRow(item: LauncherItem, icons: { app(id: string): string | undefined; dashi: string }): Row {
  const action = item.action;
  if (!action) throw new Error(`${item.id} is not an action`);
  const base = { id: `action:${action.address}`, title: action.title, item, ...(action.shortcut ? { shortcut: action.shortcut } : {}) };
  if (item.kind === "setting") {
    const pane = action.place ? PANE_TITLES.get(action.place.pane) : undefined;
    const control = controlFor(action.state?.());
    const detail = action.description || pane?.title;
    return {
      ...base,
      ...(detail ? { detail } : {}),
      kind: "Settings",
      icon: pane ? { glyph: pane.glyph } : { image: icons.dashi },
      // Enter goes to the place, at the row; Space flips the switch (launcher.tsx).
      action: { kind: "reveal", item },
      group: "settings",
      ...(control ? { control } : {}),
    };
  }
  const appId = /^dashi:\/\/app\/([^/]+)\//.exec(action.address)?.[1];
  const icon = action.icon?.startsWith("/") ? action.icon : ((appId && icons.app(appId)) ?? icons.dashi);
  return {
    ...base,
    ...(action.description && item.kind !== "menu" ? { detail: action.description } : {}),
    kind: item.kind === "menu" ? "Menu" : "Command",
    icon: { image: icon },
    action: { kind: "run", item },
    group: item.kind === "menu" ? "menu" : "command",
  };
}
