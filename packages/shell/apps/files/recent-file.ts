/** Reading the desktop's recent-files history from disk. */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { type RecentFile, parseRecentlyUsed } from "./recent.ts";
import { dataHome } from "./xdg.ts";

export async function readRecents(env: Record<string, string | undefined> = process.env): Promise<RecentFile[]> {
  try {
    return parseRecentlyUsed(await readFile(join(dataHome(env), "recently-used.xbel"), "utf8"));
  } catch {
    return [];
  }
}
