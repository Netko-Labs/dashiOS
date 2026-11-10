/**
 * GNOME Shell's search providers, as the apps install them: one key file
 * each in `<data dir>/gnome-shell/search-providers/` (Calculator,
 * Characters, Contacts, Files, Clocks…):
 *
 *   [Shell Search Provider]
 *   DesktopId=org.gnome.Characters.desktop
 *   BusName=org.gnome.Characters.BackgroundService
 *   ObjectPath=/org/gnome/Characters/SearchProvider
 *   Version=2
 *
 * Only version 2 is read (`org.gnome.Shell.SearchProvider2`), and one marked
 * `DefaultDisabled=true` stays off, as GNOME keeps it. The file is
 * untrusted: the names are checked against D-Bus's grammar before use.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isObjectPath, isWellKnownName } from "../../shared/dbus/index.ts";

export interface ProviderInfo {
  /** The desktop entry of the app it searches for (without `.desktop`): its name and icon head its rows. */
  desktopId: string;
  busName: string;
  objectPath: string;
}

const GROUP = "Shell Search Provider";

/** One provider's key file, or null when it isn't one Dashi can ask. */
export function parseProviderIni(text: string): ProviderInfo | null {
  const keys = new Map<string, string>();
  let inGroup = false;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const group = /^\[(.+)\]$/.exec(line);
    if (group) {
      inGroup = group[1] === GROUP;
      continue;
    }
    const pair = /^([A-Za-z]+)\s*=\s*(.*)$/.exec(line);
    if (inGroup && pair?.[1] && !keys.has(pair[1])) keys.set(pair[1], pair[2] ?? "");
  }
  const desktopId = keys.get("DesktopId")?.replace(/\.desktop$/, "");
  const busName = keys.get("BusName") ?? "";
  const objectPath = keys.get("ObjectPath") ?? "";
  if (keys.get("Version") !== "2" || keys.get("DefaultDisabled") === "true") return null;
  if (!desktopId || !/^[A-Za-z0-9._-]{1,200}$/.test(desktopId) || !isWellKnownName(busName) || !isObjectPath(objectPath)) return null;
  return { desktopId, busName, objectPath };
}

/** Every provider in the data directories, user first; a file name seen once wins (as XDG lookups go). */
export function readProviders(dirs: readonly string[]): ProviderInfo[] {
  const seen = new Set<string>();
  const out: ProviderInfo[] = [];
  for (const dir of dirs) {
    const folder = join(dir, "gnome-shell/search-providers");
    let names: string[] = [];
    try {
      names = readdirSync(folder)
        .filter((name) => name.endsWith(".ini"))
        .sort();
    } catch {
      continue;
    }
    for (const name of names) {
      if (seen.has(name)) continue;
      seen.add(name);
      try {
        const info = parseProviderIni(readFileSync(join(folder, name), "utf8").slice(0, 16 * 1024));
        if (info && !out.some((each) => each.busName === info.busName && each.objectPath === info.objectPath)) out.push(info);
      } catch {
        // An unreadable file is skipped.
      }
    }
  }
  return out;
}
