/**
 * An app's icon from an installed icon theme other than hicolor: KDE apps
 * keep theirs in Breeze, and plenty of others only in Adwaita or Papirus.
 * Without the lookup they would all show the generic icon. This is not the
 * full icon theme spec (no index.theme, no Inherits); it tries the layouts
 * the common themes use, the preferred themes first.
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

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
