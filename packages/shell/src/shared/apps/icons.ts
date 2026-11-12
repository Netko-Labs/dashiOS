/**
 * Icons for apps and files: an icon name as a file the renderer can draw
 * (hicolor, pixmaps, then the other installed themes), remembered once found,
 * and the XDG data folders they are looked for in.
 *
 * An app's icon from an installed icon theme other than hicolor: KDE apps
 * keep theirs in Breeze, and plenty of others only in Adwaita or Papirus.
 * Without the lookup they would all show the generic icon. This is not the
 * full icon theme spec (no index.theme, no Inherits); it tries the layouts
 * the common themes use, the preferred themes first.
 */

import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type App, iconPath, resolvePinned } from "./list.ts";

/** Tried first, in this order; every other theme follows alphabetically. */
const PREFERRED = ["breeze", "Adwaita", "Papirus", "oxygen"];

/** Sizes to try, biggest first: the Dock draws icons at 48 px and the launcher a little smaller. */
const SIZES = ["scalable", "512x512", "256x256", "128x128", "128", "96x96", "64x64", "64", "48x48", "48"];

const themeLists = new Map<string, string[]>();

/** The theme directories under an icons root, preferred ones first; hicolor, dark variants, and cursors never. */
function themesIn(root: string): string[] {
  let themes = themeLists.get(root);
  if (!themes) {
    let names: string[] = [];
    try {
      names = readdirSync(root);
    } catch {
      // No icons here.
    }
    const usable = names.filter((name) => name !== "hicolor" && !/(-dark|cursors|default)/i.test(name)).sort();
    themes = [...PREFERRED.filter((name) => usable.includes(name)), ...usable.filter((name) => !PREFERRED.includes(name))];
    themeLists.set(root, themes);
  }
  return themes;
}

/** The icon file for `name` (no path, no extension) in any theme under `roots`, or null. */
export function themeIcon(name: string, roots: readonly string[], categories: readonly string[] = ["apps"]): string | null {
  // A name that climbs out of the theme directory is not an icon name.
  if (!name || name.includes("/") || name.startsWith(".")) return null;
  for (const root of roots) {
    for (const theme of themesIn(root)) {
      for (const size of SIZES) {
        for (const ext of size === "scalable" ? ["svg"] : ["svg", "png"]) {
          // Most themes are <size>/<category>, Breeze is <category>/<size>.
          for (const category of categories) {
            for (const path of [join(root, theme, size, category, `${name}.${ext}`), join(root, theme, category, size, `${name}.${ext}`)]) {
              if (existsSync(path)) return path;
            }
          }
        }
      }
    }
  }
  return null;
}

const ICON_SIZES = ["scalable", "512x512", "256x256", "128x128", "96x96", "64x64", "48x48"];

/** An icon name (or absolute path) as a file the renderer can draw. */
export function resolveIcon(name: string, roots = iconRoots()): string {
  if (name.startsWith("/")) return existsSync(name) ? name : iconPath("generic");
  if (!name) return iconPath("generic");
  for (const root of roots) {
    for (const size of ICON_SIZES) {
      for (const ext of size === "scalable" ? ["svg"] : ["png", "svg"]) {
        const path = join(root, "hicolor", size, "apps", `${name}.${ext}`);
        if (existsSync(path)) return path;
      }
    }
  }
  for (const ext of ["svg", "png"]) {
    const path = `/usr/share/pixmaps/${name}.${ext}`;
    if (existsSync(path)) return path;
  }
  return themeIcon(name, roots) ?? iconPath("generic");
}

/**
 * Icons found so far, by name: an app's icon is looked for on disk once, not
 * at every load of the index. A name that found nothing is looked for again
 * next time (its app may be installing its icon right now).
 */
const appIcons = new Map<string, string>();

/** `resolveIcon`, remembered (`appIcons`). */
export function cachedIcon(name: string, roots: string[] = iconRoots(), resolve: (name: string, roots: string[]) => string = resolveIcon): string {
  const known = appIcons.get(name);
  if (known !== undefined) return known;
  const path = resolve(name, roots);
  if (path !== iconPath("generic")) appIcons.set(name, path);
  return path;
}

/**
 * The icon an app wears in the Dock and the launcher, for a list that names
 * apps by desktop entry (Open With): a pinned app's own (Helium is the
 * Browser), else its entry's `Icon` from the theme. `id` has no ".desktop".
 */
export function entryIcon(
  id: string,
  iconName: string,
  pinned: readonly Pick<App, "id" | "icon">[] = resolvePinned(),
  resolve: (name: string) => string = cachedIcon,
): string {
  return pinned.find((app) => app.id === id)?.icon ?? resolve(iconName);
}

/** File icons by the names asked for: a launcher keystroke never probes the theme twice for one kind of file. */
const fileIcons = new Map<string, string>();

/** The first of `names` the icon theme draws as a file or folder (`mimetypes`, `places`), else the generic icon. */
export function fileIcon(names: readonly string[], roots = iconRoots()): string {
  const key = names.join("\n");
  const known = fileIcons.get(key);
  if (known !== undefined) return known;
  let path = iconPath("generic");
  for (const name of names) {
    const themed = themeIcon(name, roots, ["mimetypes", "places"]);
    if (themed) {
      path = themed;
      break;
    }
  }
  fileIcons.set(key, path);
  return path;
}

/** XDG data directories, user first. An empty variable counts as unset (the specification says so). */
export function dataDirs(env: Record<string, string | undefined> = process.env, home: string = homedir()): string[] {
  const user = env.XDG_DATA_HOME || join(home, ".local/share");
  const system = (env.XDG_DATA_DIRS || "/usr/local/share:/usr/share").split(":").filter(Boolean);
  return [user, ...system];
}

export function iconRoots(): string[] {
  return dataDirs().map((dir) => join(dir, "icons"));
}
