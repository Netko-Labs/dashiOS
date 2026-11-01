/**
 * Preview's command line: files to open, and `--host <path>` for the Metal
 * host (the kit's flag). A file may be given as a path or, as `%U` launchers
 * and `gio open` do, a `file://` URL. Anything else (a web address) is left
 * out: Preview opens local files.
 */

import { fileURLToPath } from "node:url";

export interface Args {
  host: string | null;
  /** Absolute or relative paths, in the order given. */
  files: string[];
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
  // Some other scheme (https:, smb:) is not a local file; a path may still hold a colon.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(arg)) return null;
  return arg;
}

export function parseArgs(argv: readonly string[]): Args {
  let host: string | null = null;
  const files: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === "--host") {
      host = argv[++i] ?? null;
    } else if (arg === "--") {
      for (const rest of argv.slice(i + 1)) {
        const path = pathFromArg(rest);
        if (path) files.push(path);
      }
      break;
    } else if (!arg.startsWith("--")) {
      const path = pathFromArg(arg);
      if (path) files.push(path);
    }
  }
  return { host, files };
}
