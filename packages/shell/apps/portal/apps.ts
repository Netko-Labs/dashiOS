/**
 * The app that asked, by its id (a Flatpak's id, or a host app's desktop
 * id): its name and icon from its desktop entry, so a sheet says "Helium
 * wants…" and not "net.imput.helium wants…". An id with no entry is shown as
 * it is; no id at all is "An app".
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { dataDirs, desktopFields, resolveIcon } from "../../src/entries.ts";
import { resolvePinned } from "../../src/shared/apps/index.ts";

export interface AppInfo {
  id: string;
  name: string;
  /** An icon file, or null. */
  icon: string | null;
}

const DESKTOP_ID = /^[\w.+-]{1,255}$/;
const cache = new Map<string, AppInfo>();

export function desktopEntryText(id: string, dirs: readonly string[] = dataDirs()): string | null {
  if (!DESKTOP_ID.test(id)) return null;
  for (const dir of dirs) {
    const file = join(dir, "applications", `${id}.desktop`);
    try {
      if (existsSync(file)) return readFileSync(file, "utf8");
    } catch {
      // Unreadable here; try the next folder.
    }
  }
  return null;
}

export function appInfo(appId: string, read: (id: string) => string | null = desktopEntryText): AppInfo {
  const known = cache.get(appId);
  if (known) return known;
  const text = appId ? read(appId) : null;
  const fields = text ? desktopFields(text) : null;
  const iconName = fields?.get("Icon") ?? "";
  const info: AppInfo = {
    id: appId,
    name: fields?.get("Name") || appId.split(".").pop() || "An app",
    // As the Dock draws it: a pinned app wears Dashi's own icon (Helium is the Browser).
    icon: resolvePinned().find((app) => app.id === appId)?.icon ?? (iconName ? resolveIcon(iconName) : null),
  };
  if (!appId) info.name = "An app";
  cache.set(appId, info);
  return info;
}
