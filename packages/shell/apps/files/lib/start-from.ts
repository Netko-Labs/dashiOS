import { expandHome, normalizePath, parentOf, parseFileUri } from "../../../src/shared/files/index.ts";
import { folderAt, type Location } from "./location.ts";

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
