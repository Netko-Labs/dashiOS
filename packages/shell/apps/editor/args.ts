/**
 * Text Editor's command line: `[--host <path>] [--recover <file>] [file…]`.
 * A file may be a path or, as `%f` launchers and `gio open` pass it, a
 * `file://` URL; another scheme (a web address) is left out. `--recover`
 * names a recovery file this app wrote (recovery.ts), for a window opened to
 * show one.
 */

import { fileURLToPath } from "node:url";

export interface Args {
  host: string | null;
  /** Paths, in the order given. */
  files: string[];
  recover: string | null;
}

/** A path from a path or a `file://` URL; null for any other URL or an empty or odd value. */
export function pathFromArg(arg: string): string | null {
  if (arg === "" || arg.includes("\0")) return null;
  if (/^file:/i.test(arg)) {
    try {
      return fileURLToPath(arg);
    } catch {
      return null;
    }
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(arg)) return null;
  return arg;
}

export function parseArgs(argv: readonly string[]): Args {
  let host: string | null = null;
  let recover: string | null = null;
  const files: string[] = [];
  const add = (arg: string): void => {
    const path = pathFromArg(arg);
    if (path) files.push(path);
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === "--host") host = argv[++i] ?? null;
    else if (arg === "--recover") recover = argv[++i] ?? null;
    else if (arg === "--") {
      for (const rest of argv.slice(i + 1)) add(rest);
      break;
    } else if (!arg.startsWith("--")) add(arg);
  }
  return { host, files, recover };
}
