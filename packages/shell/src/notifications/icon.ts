/**
 * Which picture a notification wears. An app can give a path in the
 * `image-path` hint, an icon name or path in `app_icon`, or a `desktop-entry`
 * that names its launcher; the first that resolves wins, else the generic icon.
 */

import { existsSync } from "node:fs";
import { iconPath } from "../apps.ts";
import { type Entry, loadEntries, resolveIcon } from "../entries.ts";
import type { Notification } from "./types.ts";

let entries: Entry[] | null = null;
const lookedFor = new Set<string>();

/** The installed apps, read the first time a notification has no icon of its own (and again for an app not among them). */
function installed(): Entry[] {
  entries ??= loadEntries();
  return entries;
}

export interface IconSources {
  /** An icon name or absolute path to a file, as `resolveIcon` takes. */
  resolve(name: string): string | null;
  /** The icon of the installed app with this desktop id. */
  entryIcon(id: string): string | null;
}

const generic = iconPath("generic");

export const defaultSources: IconSources = {
  resolve(name) {
    const found = resolveIcon(name);
    return found === generic ? null : found;
  },
  entryIcon(id) {
    let entry = installed().find((candidate) => candidate.id === id);
    // An app installed since the list was read: read it again, once per id.
    if (!entry && !lookedFor.has(id)) {
      lookedFor.add(id);
      entries = loadEntries();
      entry = entries.find((candidate) => candidate.id === id);
    }
    return entry && existsSync(entry.icon) ? entry.icon : null;
  },
};

export function notificationIcon(notification: Pick<Notification, "imagePath" | "appIcon" | "desktopEntry">, sources: IconSources = defaultSources): string {
  const { imagePath, appIcon, desktopEntry } = notification;
  return (imagePath && sources.resolve(imagePath)) || (appIcon && sources.resolve(appIcon)) || (desktopEntry && sources.entryIcon(desktopEntry)) || generic;
}
