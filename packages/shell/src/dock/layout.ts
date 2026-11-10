/**
 * What the Dock shows, as a pure function of the pinned ids, the installed
 * apps, and the windows: the pinned apps in their order, then the apps that
 * are running without being pinned, and the minimized windows. Windows are
 * matched to apps by the app id they report, the way the menus find an app's
 * launcher entry (menus/launch.ts), then by the name of the program the
 * entry runs.
 */

import { basename } from "node:path";
import type { Toplevel } from "@mirinjs/metal";
import { type DockItem, displayName, ownApp } from "../apps.ts";
import type { Entry } from "../entries.ts";
import { findEntry } from "../menus/index.ts";
import { type App, iconPath } from "../shared/apps/index.ts";

/** Programs that start other programs: their name says nothing about the app. */
const WRAPPERS = new Set(["env", "sh", "bash", "flatpak", "snap", "bun", "node", "python", "python3", "gtk-launch"]);

/** The installed app a window's app id stands for, if there is one. */
export function matchEntry(catalog: readonly Entry[], appId: string): Entry | undefined {
  if (!appId) return undefined;
  const found = findEntry(catalog, appId);
  if (found) return found;
  const lower = appId.toLowerCase();
  return catalog.find((entry) => {
    const program = entry.exec?.[0];
    const name = program ? basename(program).toLowerCase() : "";
    return name !== "" && !WRAPPERS.has(name) && name === lower;
  });
}

/**
 * What a window's app is called in the Dock: the installed app's id, else the
 * app id it reported, else the window itself (windows without an app id each
 * stand alone).
 */
export function appKey(catalog: readonly Entry[], window: Pick<Toplevel, "id" | "appId">): string {
  if (!window.appId) return `window:${window.id}`;
  return matchEntry(catalog, window.appId)?.id ?? window.appId;
}

export interface DockEntry extends DockItem {
  /** Stable while the app stays in the Dock: the app's id, or the window's for one without. */
  key: string;
}

export interface MinimizedEntry {
  window: Toplevel;
  app: App;
}

export interface DockLayout {
  /** In the order they are kept. */
  pinned: DockEntry[];
  /** Running and not kept, in the order they first appeared. */
  running: DockEntry[];
  /** Minimized windows, in the order they first appeared. */
  minimized: MinimizedEntry[];
}

export function dockLayout(pinnedIds: readonly string[], catalog: readonly Entry[], windows: readonly Toplevel[]): DockLayout {
  const installed = new Map<string, Entry>();
  for (const entry of catalog) if (!installed.has(entry.id)) installed.set(entry.id, entry);

  const groups = new Map<string, Toplevel[]>();
  for (const window of windows) {
    const key = appKey(catalog, window);
    const group = groups.get(key);
    if (group) group.push(window);
    else groups.set(key, [window]);
  }

  const pinned: DockEntry[] = pinnedIds.flatMap((id) => {
    const app = installed.get(id);
    return app ? [{ key: app.id, app, windows: groups.get(app.id) ?? [], pinned: true }] : [];
  });
  const kept = new Set(pinned.map((entry) => entry.key));

  const running: DockEntry[] = [];
  for (const [key, group] of groups) {
    const first = group[0];
    if (kept.has(key) || !first) continue;
    const app: App = installed.get(key) ??
      ownApp(first.appId) ?? {
        id: first.appId,
        name: displayName(first.appId, first.title),
        icon: iconPath("generic"),
      };
    running.push({ key, app, windows: group, pinned: false });
  }

  const apps = new Map([...pinned, ...running].map((entry) => [entry.key, entry.app]));
  const minimized = windows.flatMap((window) => {
    const app = window.minimized ? apps.get(appKey(catalog, window)) : undefined;
    return app ? [{ window, app }] : [];
  });
  return { pinned, running, minimized };
}
