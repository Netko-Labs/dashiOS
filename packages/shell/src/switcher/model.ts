/**
 * The app switcher as plain data: windows grouped by app (most recent app
 * first, each app's windows in the compositor's order: front to back, then
 * minimized, then hidden), what typing keeps, how the selection steps, and
 * which keys act. Pure, so every rule is tested (test/switcher.test.ts).
 */

import type { CompositorWindow } from "../compositor/index.ts";

/** One app in the switcher, with every window it has. */
export interface AppGroup {
  appId: string;
  /** Its front window's title (the name to show when the app is not installed). */
  title: string;
  windows: CompositorWindow[];
}

/** Which app is chosen, and which of its windows (null: the app, its front window). */
export interface Selection {
  app: number;
  window: number | null;
}

export type Step = "next" | "previous" | "down" | "up" | "left" | "right";

/** What ❖ with Q, H, M, or W does to the selection. */
export type SwitcherAction = "quit" | "hide" | "minimize" | "close";

const ACTION_KEYS: Readonly<Record<string, SwitcherAction>> = { q: "quit", h: "hide", m: "minimize", w: "close" };

/** Windows of one app: the same app id (separate processes of one app are one app), else the same process. */
const appKey = (window: CompositorWindow): string => (window.appId ? `app:${window.appId}` : window.pid !== null ? `pid:${window.pid}` : `window:${window.id}`);

/** The windows by app, apps in the order their first window comes (most recently used first). */
export function groupByApp(windows: readonly CompositorWindow[]): AppGroup[] {
  const groups = new Map<string, AppGroup>();
  for (const window of windows) {
    const key = appKey(window);
    const group = groups.get(key);
    if (group) group.windows.push(window);
    else groups.set(key, { appId: window.appId, title: window.title, windows: [window] });
  }
  return [...groups.values()];
}

/** Whether every window of the app is out of sight (minimized or hidden): it is dimmed. */
export const isAway = (group: AppGroup): boolean => group.windows.every((window) => window.state !== "normal");

/**
 * The apps and windows `query` finds: an app whose name (or app id) has it,
 * with all its windows; else only the windows whose titles have it. Apps
 * whose name starts with it come first; otherwise the order stays.
 */
export function filterApps(groups: readonly AppGroup[], query: string, nameOf: (group: AppGroup) => string): AppGroup[] {
  const wanted = query.trim().toLowerCase();
  if (wanted === "") return [...groups];
  const found = groups.flatMap((group) => {
    const name = nameOf(group).toLowerCase();
    const named = name.includes(wanted) || group.appId.toLowerCase().includes(wanted);
    const windows = named ? group.windows : group.windows.filter((window) => window.title.toLowerCase().includes(wanted));
    return windows.length > 0 ? [{ group: { ...group, windows }, starts: name.startsWith(wanted) }] : [];
  });
  return [...found.filter((each) => each.starts), ...found.filter((each) => !each.starts)].map((each) => each.group);
}

const wrap = (index: number, length: number) => (length === 0 ? 0 : (index + length) % length);

/** The selection after `step`: Tab and ⇧Tab through apps, ↓ and ` into (and through) the app's windows, ↑ back to the apps, ← → along the row it is on. */
export function stepSelection(selection: Selection, groups: readonly AppGroup[], step: Step): Selection {
  const count = groups.length;
  if (count === 0) return { app: 0, window: null };
  const app = Math.min(selection.app, count - 1);
  const windows = groups[app]?.windows.length ?? 0;
  switch (step) {
    case "next":
      return { app: wrap(app + 1, count), window: null };
    case "previous":
      return { app: wrap(app - 1, count), window: null };
    case "down":
      return windows === 0 ? { app, window: null } : { app, window: selection.window === null ? 0 : wrap(selection.window + 1, windows) };
    case "up":
      return { app, window: null };
    case "left":
    case "right": {
      const by = step === "left" ? -1 : 1;
      return selection.window === null ? { app: wrap(app + by, count), window: null } : { app, window: wrap(selection.window + by, windows) };
    }
  }
}

/** The window choosing `selection` brings forward: the selected one, else the app's front window. */
export function chosenWindow(groups: readonly AppGroup[], selection: Selection): CompositorWindow | null {
  const windows = groups[selection.app]?.windows ?? [];
  return windows[selection.window ?? 0] ?? null;
}

/**
 * A key typed while ❖ is held (the keymap's `switcher-key`, keymap.ts): text
 * for the query, or, while nothing is typed yet, Q, H, M, or W's action.
 * Null for a key that is neither.
 */
export function switcherKey(key: string, query: string): { kind: "type"; text: string } | { kind: "act"; action: SwitcherAction } | null {
  const text = key === "space" ? " " : key.length === 1 ? key.toLowerCase() : null;
  if (text === null || !/^[a-z0-9 ]$/.test(text)) return null;
  const action = ACTION_KEYS[text];
  if (query === "" && action) return { kind: "act", action };
  return { kind: "type", text };
}

/** The windows the row shows at once, at most; past them it slides with the selection. */
export const ROW_WINDOWS = 6;

/** Which of `count` windows the row shows, as [start, end), keeping `selected` in view. */
export function visibleWindows(count: number, selected: number | null, most = ROW_WINDOWS): [number, number] {
  if (count <= most) return [0, count];
  const at = selected ?? 0;
  const start = Math.min(Math.max(0, at - most + 1), count - most);
  return [start, start + most];
}
