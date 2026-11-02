/** What a Files window needs from the machine, gathered once so tests can swap each part. */

import { homedir, userInfo } from "node:os";
import { type Archiver, findArchiver } from "./archive.ts";
import { type SystemFiles, systemFiles } from "./clipboard.ts";
import { type Exec, exec } from "./exec.ts";
import { type MimeIndex, systemMimeIndex } from "./mime.ts";
import { readRecents } from "./recent-file.ts";
import type { TrashPlaces } from "./trashops.ts";
import { cacheHome, trashFilesDir, trashInfoDir, type UserDirName, userDirs } from "./xdg.ts";

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
