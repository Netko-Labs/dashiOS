/** The person's folders: `user-dirs.dirs` (xdg-user-dirs), with the usual names as the fallback, and the Trash's place. */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { normalizePath } from "./paths.ts";

export type UserDirName = "DESKTOP" | "DOCUMENTS" | "DOWNLOAD" | "MUSIC" | "PICTURES" | "VIDEOS";

export const USER_DIR_NAMES: readonly UserDirName[] = ["DESKTOP", "DOCUMENTS", "DOWNLOAD", "MUSIC", "PICTURES", "VIDEOS"];

const DEFAULTS: Record<UserDirName, string> = {
  DESKTOP: "Desktop",
  DOCUMENTS: "Documents",
  DOWNLOAD: "Downloads",
  MUSIC: "Music",
  PICTURES: "Pictures",
  VIDEOS: "Videos",
};

/**
 * The `XDG_*_DIR="…"` lines of user-dirs.dirs as absolute paths. Only the two
 * forms the file's own header allows count: `$HOME/…` and an absolute path;
 * anything else (a relative path, a path with `..` that leaves the filesystem
 * root, a stray `$VAR`) is skipped.
 */
export function parseUserDirs(text: string, home: string): Partial<Record<UserDirName, string>> {
  const dirs: Partial<Record<UserDirName, string>> = {};
  for (const raw of text.split("\n")) {
    const match = /^\s*XDG_([A-Z]+)_DIR\s*=\s*"((?:[^"\\]|\\.)*)"\s*$/.exec(raw);
    if (!match) continue;
    const name = USER_DIR_NAMES.find((candidate) => candidate === match[1]);
    if (!name) continue;
    const value = (match[2] ?? "").replace(/\\(.)/g, "$1");
    const path = value === "$HOME" ? home : value.startsWith("$HOME/") ? `${home}${value.slice("$HOME".length)}` : value;
    const clean = path.includes("$") ? null : normalizePath(path);
    if (clean) dirs[name] = clean;
  }
  return dirs;
}

/** The user dirs that exist here, in `USER_DIR_NAMES` order. The home folder itself never counts as one (xdg-user-dirs points unset dirs at it). */
export function userDirs(
  env: Record<string, string | undefined> = process.env,
  home: string = homedir(),
  exists: (path: string) => boolean = existsSync,
): Array<{ name: UserDirName; path: string }> {
  const config = env.XDG_CONFIG_HOME || join(home, ".config");
  let parsed: Partial<Record<UserDirName, string>> = {};
  try {
    parsed = parseUserDirs(readFileSync(join(config, "user-dirs.dirs"), "utf8"), home);
  } catch {
    // The defaults stand.
  }
  return USER_DIR_NAMES.flatMap((name) => {
    const path = parsed[name] ?? join(home, DEFAULTS[name]);
    return path !== home && exists(path) ? [{ name, path }] : [];
  });
}

export function dataHome(env: Record<string, string | undefined> = process.env, home: string = homedir()): string {
  return env.XDG_DATA_HOME || join(home, ".local/share");
}

export function cacheHome(env: Record<string, string | undefined> = process.env, home: string = homedir()): string {
  return env.XDG_CACHE_HOME || join(home, ".cache");
}

/** The home Trash's `files` folder (the Trash specification's `$XDG_DATA_HOME/Trash`). */
export function trashFilesDir(env: Record<string, string | undefined> = process.env, home: string = homedir()): string {
  return join(dataHome(env, home), "Trash/files");
}

export function trashInfoDir(env: Record<string, string | undefined> = process.env, home: string = homedir()): string {
  return join(dataHome(env, home), "Trash/info");
}
