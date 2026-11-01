/**
 * Finding Wallpaper Engine's items. They live in Steam's Workshop folder for
 * app 431960, in whichever Steam library holds them: the usual places under
 * the home directory (a native Steam, the old `~/.steam` link, Flatpak and
 * Snap Steam) and any further library `libraryfolders.vdf` names. A scene
 * needs Wallpaper Engine's own `assets` folder, which sits next to the app in
 * `steamapps/common/wallpaper_engine`; without it only videos can play.
 */

import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import { isFileInside, MAX_PROJECT_BYTES, parseProject, type WorkshopItem } from "./project.ts";

export const WALLPAPER_ENGINE_APP = "431960";
/** Seen at most: a Workshop folder of a few hundred items is a lot. */
const MAX_ITEMS = 500;

export interface Discovery {
  items: WorkshopItem[];
  /** Wallpaper Engine's `assets` folder, null when Steam does not have it. */
  assets: string | null;
  /** The Steam libraries looked in. */
  libraries: string[];
  /** Items that were skipped, and why (for the log, never for the screen). */
  skipped: string[];
}

/** The folders a Steam install keeps its `steamapps` in. */
export function steamRoots(home: string, env: Record<string, string | undefined> = process.env): string[] {
  const data = env.XDG_DATA_HOME || join(home, ".local", "share");
  return [
    join(data, "Steam"),
    join(home, ".steam", "steam"),
    join(home, ".steam", "root"),
    join(home, ".var", "app", "com.valvesoftware.Steam", ".local", "share", "Steam"),
    join(home, ".var", "app", "com.valvesoftware.Steam", ".steam", "steam"),
    join(home, "snap", "steam", "common", ".local", "share", "Steam"),
  ];
}

/** The other libraries a `libraryfolders.vdf` names: its `"path"` lines, absolute only. */
export function vdfLibraries(text: string): string[] {
  const paths = [...text.matchAll(/"path"\s+"((?:[^"\\\0-\x1f]|\\.)*)"/g)].map((match) => (match[1] ?? "").replace(/\\(["\\])/g, "$1"));
  return paths.filter((path) => path.startsWith("/") && !/[\0-\x1f]/.test(path));
}

const isDirectory = (path: string): boolean => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

const realOrNull = (path: string): string | null => {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
};

/** Every Steam library that exists (once each, as links resolve): the roots, and what their `libraryfolders.vdf` adds. */
export function steamLibraries(home: string, env: Record<string, string | undefined> = process.env): string[] {
  const found = new Map<string, string>();
  const add = (path: string) => {
    const real = realOrNull(path);
    if (real !== null && isDirectory(join(real, "steamapps")) && !found.has(real)) found.set(real, real);
  };
  for (const root of steamRoots(home, env)) {
    add(root);
    try {
      for (const path of vdfLibraries(readFileSync(join(root, "steamapps", "libraryfolders.vdf"), "utf8"))) add(path);
    } catch {
      // No such file: this root has no extra libraries.
    }
  }
  return [...found.values()];
}

/** Everything Wallpaper Engine has in the libraries under `home`. Never throws. */
export function discoverWorkshop(home: string, env: Record<string, string | undefined> = process.env): Discovery {
  const libraries = steamLibraries(home, env);
  const items = new Map<string, WorkshopItem>();
  const skipped: string[] = [];
  let assets: string | null = null;
  for (const library of libraries) {
    const candidate = join(library, "steamapps", "common", "wallpaper_engine", "assets");
    if (assets === null && isDirectory(candidate)) assets = candidate;
    const content = join(library, "steamapps", "workshop", "content", WALLPAPER_ENGINE_APP);
    let names: string[] = [];
    try {
      names = readdirSync(content);
    } catch {
      continue;
    }
    for (const id of names) {
      if (items.size >= MAX_ITEMS) break;
      if (items.has(id)) continue;
      const dir = join(content, id);
      const file = join(dir, "project.json");
      if (!existsSync(file) || !isFileInside(dir, "project.json")) continue;
      let text: string;
      try {
        if (statSync(file).size > MAX_PROJECT_BYTES) throw new Error("too large");
        text = readFileSync(file, "utf8");
      } catch {
        skipped.push(`${id}: project.json cannot be read`);
        continue;
      }
      const result = parseProject(text, dir, id);
      if (result.ok) items.set(id, result.item);
      else skipped.push(`${id}: ${result.reason}`);
    }
  }
  const sorted = [...items.values()].sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  return { items: sorted, assets, libraries, skipped };
}

/** Whether Settings can offer `item`: a scene or a web page needs the assets, a video does not. */
export const isPlayable = (item: WorkshopItem, assets: string | null): boolean => assets !== null || item.type === "video";
