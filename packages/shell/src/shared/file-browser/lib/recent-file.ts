/** The desktop's recent-files history on disk: read, and a file used added to it. */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { dataHome, mimeOf, systemMimeIndex } from "../../files/index.ts";
import { parseRecentlyUsed, type RecentFile, withRecent } from "./recent.ts";

const historyPath = (env: Record<string, string | undefined>): string => join(dataHome(env), "recently-used.xbel");

export async function readRecents(env: Record<string, string | undefined> = process.env): Promise<RecentFile[]> {
  try {
    return parseRecentlyUsed(await readFile(historyPath(env), "utf8"));
  } catch {
    return [];
  }
}

/** The app's name without what a line of the history can't carry (control characters), at a length a name has. */
const appName = (app: string): string =>
  app
    .replace(/[\0-\x1f\x7f]+/g, " ")
    .trim()
    .slice(0, 128) || "dashi";

/**
 * The history's `exec` for an app: its name as one quoted word, then the
 * file. The name is whatever the asking app called itself (a window title
 * when it gave no id), and launchers read this line the shell's way, so a
 * quote in it is written `'\''`: it stays inside the word and never ends it.
 */
export const recentExec = (app: string): string => `'${appName(app).replaceAll("'", "'\\''")}' %u`;

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
    const uses = paths.map((file) => ({ path: file, mime: mimeOf(index, basename(file)), app: appName(app), exec: recentExec(app) }));
    await mkdir(dataHome(env), { recursive: true });
    const partial = `${path}.${process.pid}.partial`;
    await writeFile(partial, withRecent(before, uses, new Date()), { mode: 0o600 });
    await rename(partial, path);
  } catch {
    // Not remembered: Recents just won't list them.
  }
}
