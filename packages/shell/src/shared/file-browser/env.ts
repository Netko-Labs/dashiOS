/** What a Files window (and the chooser) needs from the machine, gathered once so tests can swap each part. */

import { homedir, userInfo } from "node:os";
import {
  cacheHome,
  type Exec,
  exec,
  type MimeIndex,
  systemMimeIndex,
  type TrashPlaces,
  trashFilesDir,
  trashInfoDir,
  type UserDirName,
  userDirs,
} from "../files/index.ts";
import { systemFiles } from "./clipboard.ts";
import { findArchiver } from "./lib/operations/archive.ts";
import { readRecents } from "./lib/recent-file.ts";
import type { Archiver, SystemFiles } from "./types.ts";

export interface Env {
  home: string;
  user: string;
  mime: MimeIndex;
  run: Exec;
  clipboard: SystemFiles;
  archiver: Archiver | null;
  trash: TrashPlaces;
  cache: string;
  dirs: ReadonlyArray<{ name: UserDirName; path: string }>;
  now: () => number;
  /** Recent files from the desktop's history, newest first. */
  recents: () => Promise<Array<{ path: string; time: number }>>;
}

export function systemEnv(): Env {
  const home = process.env.HOME || homedir();
  return {
    home,
    user: (() => {
      try {
        return userInfo().username;
      } catch {
        return process.env.USER ?? "user";
      }
    })(),
    mime: systemMimeIndex(),
    run: exec,
    clipboard: systemFiles(),
    archiver: findArchiver(),
    trash: { files: trashFilesDir(), info: trashInfoDir() },
    cache: cacheHome(),
    dirs: userDirs(),
    now: Date.now,
    recents: () => readRecents(),
  };
}
