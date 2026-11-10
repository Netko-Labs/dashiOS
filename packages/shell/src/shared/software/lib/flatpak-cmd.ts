/**
 * The exact commands Software runs, as argument lists. Nothing is built from
 * text that came off the network except application ids, and those are
 * checked first (ids.ts) so they can't read as an option.
 */

import { type Installation, isAppId, isInstallation } from "../ids.ts";

export const FLATHUB_REMOTE = "flathub";
export const FLATHUB_REPO_FILE = "https://dl.flathub.org/repo/flathub.flatpakrepo";

function assertId(id: string): string {
  if (!isAppId(id)) throw new Error(`not an application id: ${String(id).slice(0, 40)}`);
  return id;
}

function assertInstallation(installation: Installation): `--${Installation}` {
  if (!isInstallation(installation)) throw new Error("unknown installation");
  return `--${installation}`;
}

/** The user's Flathub remote, added only when the person installs something. */
export const remoteAdd = (): string[] => ["flatpak", "remote-add", "--user", "--if-not-exists", FLATHUB_REMOTE, FLATHUB_REPO_FILE];

/**
 * Installs for the user. With `progress`, flatpak is not told `--noninteractive`
 * (that silences its progress bar) and runs on a terminal; `-y` still answers
 * every question.
 */
export const install = (id: string, progress = false): string[] => [
  "flatpak",
  "install",
  "--user",
  "-y",
  ...(progress ? [] : ["--noninteractive"]),
  FLATHUB_REMOTE,
  assertId(id),
];

/** Removes an app; `deleteData` also deletes what it saved (`~/.var/app/<id>`), which flatpak keeps otherwise. */
export const uninstall = (id: string, installation: Installation, deleteData = false): string[] => [
  "flatpak",
  "uninstall",
  assertInstallation(installation),
  "-y",
  "--noninteractive",
  ...(deleteData ? ["--delete-data"] : []),
  assertId(id),
];

/** Updates one app, or everything in the installation when `id` is omitted. */
export const update = (installation: Installation, id?: string, progress = false): string[] => [
  "flatpak",
  "update",
  assertInstallation(installation),
  "-y",
  ...(progress ? [] : ["--noninteractive"]),
  ...(id === undefined ? [] : [assertId(id)]),
];

export const LIST_COLUMNS = ["application", "name", "version", "branch", "arch", "origin", "installation", "size", "description"] as const;
export const list = (): string[] => ["flatpak", "list", "--app", `--columns=${LIST_COLUMNS.join(",")}`];

export const UPDATE_COLUMNS = ["application", "name", "version", "branch", "arch", "origin", "download-size"] as const;
export const updatesAvailable = (installation: Installation): string[] => [
  "flatpak",
  "remote-ls",
  assertInstallation(installation),
  "--updates",
  "--app",
  `--columns=${UPDATE_COLUMNS.join(",")}`,
];

/** Starts an installed app. */
export const runApp = (id: string): string[] => ["flatpak", "run", assertId(id)];

export const pkconGetUpdates = (): string[] => ["pkcon", "get-updates"];
export const pkconRefresh = (): string[] => ["pkcon", "refresh"];
/** Installs every pending system update; polkit asks for authentication. */
export const pkconUpdate = (): string[] => ["pkcon", "-p", "-y", "update"];
/** Whether a restart is needed (exit status 1 when it is), from dnf's cache: no download. */
export const needsRestarting = (): string[] => ["dnf", "needs-restarting", "-r", "--cacheonly"];
