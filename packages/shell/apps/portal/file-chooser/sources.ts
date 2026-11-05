/**
 * Where the chooser's rows come from, on this machine: the desktop's
 * recent-files history and folders read the way Files reads them (Files'
 * recent-file.ts, items.ts, mime.ts), and search through LocalSearch, as the
 * launcher's (src/file-search.ts).
 */

import { homedir } from "node:os";
import { dirname } from "node:path";
import { searchFiles } from "../../../src/file-search.ts";
import { exec } from "../../files/exec.ts";
import { type FileItem, itemAt, readFolder } from "../../files/items.ts";
import { systemMimeIndex } from "../../files/mime.ts";
import { readRecents } from "../../files/recent-file.ts";
import { userDirs } from "../../files/xdg.ts";
import { type Row, type Sources, tilde } from "./model.ts";

const MAX_RECENTS = 60;
const MAX_HITS = 40;

function toRow(item: FileItem, home: string, where: boolean): Row {
  return {
    path: item.path,
    name: item.name,
    folder: item.kind === "folder",
    mime: item.mime,
    mtime: item.mtime,
    hidden: item.hidden,
    ...(where ? { where: tilde(dirname(item.path), home) } : {}),
  };
}

async function rowsAt(paths: readonly string[], home: string): Promise<Row[]> {
  const index = systemMimeIndex();
  const items = await Promise.all(paths.map((path) => itemAt(path, index)));
  return items.flatMap((item) => (item && item.kind !== "other" ? [toRow(item, home, true)] : []));
}

export function machineSources(home: string = homedir()): Sources {
  return {
    home,
    async recents() {
      const recents = await readRecents();
      return rowsAt(
        recents.slice(0, MAX_RECENTS).map((recent) => recent.path),
        home,
      );
    },
    async search(query) {
      const run = async (command: readonly string[]) => {
        const outcome = await exec(command, { limit: 1 << 20 });
        return outcome.ok ? outcome.stdout : null;
      };
      const hits = await searchFiles(query, run, home, MAX_HITS);
      return rowsAt(
        hits.map((hit) => hit.path),
        home,
      );
    },
    async folder(path) {
      const listing = await readFolder(path, systemMimeIndex());
      return { rows: listing.items.filter((item) => item.kind !== "other").map((item) => toRow(item, home, false)), error: listing.error };
    },
  };
}

export interface PlaceLink {
  label: string;
  path: string;
}

const DIR_LABELS = { DESKTOP: "Desktop", DOCUMENTS: "Documents", DOWNLOAD: "Downloads", MUSIC: "Music", PICTURES: "Pictures", VIDEOS: "Videos" } as const;

/** The sidebar's folders: home, then the user folders this machine has. */
export function placeLinks(home: string = homedir()): PlaceLink[] {
  return [{ label: "Home", path: home }, ...userDirs(process.env, home).map((dir) => ({ label: DIR_LABELS[dir.name], path: dir.path }))];
}

/** The Documents folder, if there is one. */
export function documentsFolder(home: string = homedir()): string | null {
  return userDirs(process.env, home).find((dir) => dir.name === "DOCUMENTS")?.path ?? null;
}
