/**
 * Files (dev.dashi.files): `bun apps/files/main.tsx [--host <path>] [--info] [folder or file or file:// URI…]`.
 * With a folder it opens there; with a file it opens the file's folder with
 * the file selected; with none, the home folder. This is what `gio open` runs
 * for `inode/directory` once Files is the default handler (src/shared/apps/first-party.ts).
 * A path is not the Metal host here: `--host` or DASHI_METAL_HOST says which.
 */

import { statSync } from "node:fs";
import { METAL_HOST } from "../../src/shared/apps/index.ts";
import { systemEnv } from "../../src/shared/file-browser/env.ts";
import { Operations } from "../../src/shared/file-browser/operations.ts";
import { readPrefs, writePrefs } from "../../src/shared/file-browser/prefs.ts";
import { FilesStore } from "../../src/shared/file-browser/store.ts";
import { runApp } from "../kit/index.ts";
import { parseArgs } from "./lib/args.ts";
import { startFrom } from "./lib/start-from.ts";
import { FILES_SIZE, FilesWindow } from "./lib/views/view.tsx";

const kind = (path: string): boolean | null => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return null;
  }
};

if (import.meta.main) {
  const env = systemEnv();
  const args = parseArgs(Bun.argv.slice(2));
  const start = startFrom(args.paths, env.home, kind);
  // The view, the sort, and Show Hidden as they were left (prefs.ts).
  const store = new FilesStore(env, start.location, { prefs: { read: () => readPrefs(), write: (prefs) => writePrefs(prefs) } });
  const ops = new Operations(store);
  store.start();
  if (start.select.length > 0) store.select(start.select);
  // The launcher's "Search files for …": open on a search for those words.
  const searchFor = process.env.DASHI_FILES_SEARCH?.trim();
  if (searchFor) store.setQuery(searchFor);
  runApp(
    { id: "dev.dashi.files", title: "Files", size: FILES_SIZE, host: args.host ?? process.env.DASHI_METAL_HOST ?? METAL_HOST },
    <FilesWindow store={store} ops={ops} {...(args.info && start.select[0] ? { info: start.select[0] } : {})} />,
  );
}
