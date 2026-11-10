/** The desktop's recent-files history on disk: read, and a file used added to it. */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { mimeOf, systemMimeIndex } from "../../src/shared/files/mime.ts";
import { dataHome } from "../../src/shared/files/xdg.ts";
import { parseRecentlyUsed, type RecentFile, withRecent } from "./recent.ts";

const historyPath = (env: Record<string, string | undefined>): string => join(dataHome(env), "recently-used.xbel");

export async function readRecents(env: Record<string, string | undefined> = process.env): Promise<RecentFile[]> {
  try {
    return parseRecentlyUsed(await readFile(historyPath(env), "utf8"));
  } catch {
    return [];
  }
}

/**
 * Files an app opened or saved through the chooser, into the history (written
 * beside it, then renamed in place), so Recents lists them next time. A
 * failure only means they aren't listed.
 */
export async function recordRecents(paths: readonly string[], app: string, env: Record<string, string | undefined> = process.env): Promise<void> {
  if (paths.length === 0) return;
  const path = historyPath(env);
  try {
    const before = await readFile(path, "utf8").catch(() => null);
    const index = systemMimeIndex(env);
    const uses = paths.map((file) => ({ path: file, mime: mimeOf(index, basename(file)), app, exec: `'${app}' %u` }));
    await mkdir(dataHome(env), { recursive: true });
    const partial = `${path}.${process.pid}.partial`;
    await writeFile(partial, withRecent(before, uses, new Date()), { mode: 0o600 });
    await rename(partial, path);
  } catch {
    // Not remembered: Recents just won't list them.
  }
}
