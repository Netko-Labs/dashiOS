/**
 * Files (dev.dashi.files): `bun apps/files/main.tsx [--host <path>] [--info] [folder or file or file:// URI…]`.
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

/**
 * Where the window opens: the first argument that names something here (a
 * path, `~/…`, or a `file://` URI). A folder opens; a file opens its folder
 * with it selected, and so do the arguments after it in that same folder
 * (a "Show in folder" of several). The Metal host's own path is skipped.
 */
export function startFrom(args: readonly string[], home: string, isDirectory: (path: string) => boolean | null): { location: Location; select: string[] } {
  const paths = args.flatMap((arg) => {
    const path = normalizePath(arg.startsWith("file://") ? (parseFileUri(arg) ?? "") : expandHome(arg, home));
    return path === null ? [] : [path];
  });
  for (const [index, path] of paths.entries()) {
    const directory = isDirectory(path);
    if (directory === true) return { location: folderAt(path), select: [] };
    if (directory === false) {
      const folder = parentOf(path);
      const rest = paths.slice(index + 1).filter((other) => parentOf(other) === folder && isDirectory(other) !== null);
      return { location: folderAt(folder), select: [path, ...rest] };
    }
  }
  return { location: folderAt(home), select: [] };
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
  if (start.select.length > 0) store.select(start.select);
  runApp(
    { id: "dev.dashi.files", title: "Files", size: FILES_SIZE, host: args.host ?? process.env.DASHI_METAL_HOST ?? METAL_HOST },
    <FilesWindow store={store} ops={ops} {...(args.info && start.select[0] ? { info: start.select[0] } : {})} />,
  );
}
