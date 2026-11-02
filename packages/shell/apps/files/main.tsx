/**
 * Files (dev.dashi.files): `bun apps/files/main.tsx [--host <path>] [folder or file or file:// URI…]`.
 * With a folder it opens there; with a file it opens the file's folder with
 * the file selected; with none, the home folder. This is what `gio open` runs
 * for `inode/directory` once Files is the default handler (first-party.ts).
 * A path is not the Metal host here: `--host` or DASHI_METAL_HOST says which.
 */

import { statSync } from "node:fs";
import { METAL_HOST } from "../../src/apps.ts";
import { runApp } from "../kit/index.ts";
import { parseArgs } from "./args.ts";
import { systemEnv } from "./env.ts";
import { folderAt, type Location } from "./location.ts";
import { Operations } from "./operations.ts";
import { expandHome, normalizePath, parentOf } from "./paths.ts";
import { FilesStore } from "./store.ts";
import { parseFileUri } from "./uri.ts";
import { FILES_SIZE, FilesWindow } from "./view.tsx";

/** The first argument that names something here: a path, `~/…`, or a `file://` URI. The Metal host's own path is skipped. */
export function startFrom(args: readonly string[], home: string, isDirectory: (path: string) => boolean | null): { location: Location; select?: string } {
  for (const arg of args) {
    const path = normalizePath(arg.startsWith("file://") ? (parseFileUri(arg) ?? "") : expandHome(arg, home));
    if (path === null) continue;
    const directory = isDirectory(path);
    if (directory === true) return { location: folderAt(path) };
    if (directory === false) return { location: folderAt(parentOf(path)), select: path };
  }
  return { location: folderAt(home) };
}

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
  const store = new FilesStore(env, start.location);
  const ops = new Operations(store);
  store.start();
  if (start.select) store.select([start.select]);
  runApp(
    { id: "dev.dashi.files", title: "Files", size: FILES_SIZE, host: args.host ?? process.env.DASHI_METAL_HOST ?? METAL_HOST },
    <FilesWindow store={store} ops={ops} />,
  );
}
