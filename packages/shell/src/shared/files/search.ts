/**
 * Searching from Files: the current folder and everything below it (a walk
 * that never follows a link and gives up at a budget), or the whole computer
 * through LocalSearch, the indexer the launcher asks too.
 */

import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { type Exec, exec } from "./exec.ts";
import { searchFiles } from "./file-search.ts";
import { type FileItem, itemAt } from "./items.ts";
import type { MimeIndex } from "./mime.ts";
import { tilde } from "./paths.ts";

export const MAX_RESULTS = 500;
const MAX_VISITED = 60_000;

export interface FolderSearch {
  items: FileItem[];
  /** The walk stopped at its budget before it saw everything. */
  truncated: boolean;
}

export function matchesName(name: string, query: string): boolean {
  return name.toLowerCase().includes(query.toLowerCase());
}

/**
 * Items under `root` whose names contain `query`. Folders are entered with
 * `readdir` and never through a link; hidden items count only with `hidden`.
 * `onBatch` hears about the results so far a few times a second so the list
 * can fill while the walk goes on.
 */
export async function searchFolder(
  root: string,
  query: string,
  options: { hidden: boolean; home: string; index: MimeIndex; signal?: AbortSignal; onBatch?: (items: FileItem[]) => void },
): Promise<FolderSearch> {
  const found: FileItem[] = [];
  const queue: string[] = [root];
  let visited = 0;
  let lastReport = 0;
  while (queue.length > 0 && found.length < MAX_RESULTS && visited < MAX_VISITED) {
    if (options.signal?.aborted) break;
    const dir = queue.shift() as string;
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      visited++;
      const hidden = entry.name.startsWith(".");
      if (hidden && !options.hidden) continue;
      const path = join(dir, entry.name);
      // Real folders only: a symlink to a folder is listed if it matches but is not walked.
      if (entry.isDirectory()) queue.push(path);
      if (matchesName(entry.name, query)) {
        const item = await itemAt(path, options.index);
        if (item) found.push({ ...item, where: tilde(dir, options.home) });
        if (found.length >= MAX_RESULTS) break;
      }
    }
    const now = Date.now();
    if (options.onBatch && now - lastReport > 150) {
      lastReport = now;
      options.onBatch([...found]);
      await Bun.sleep(0);
    }
  }
  return { items: found, truncated: queue.length > 0 };
}

/** LocalSearch's hits for `query` as items (newest first). Empty for a short query or when LocalSearch isn't there. */
export async function searchComputer(query: string, home: string, index: MimeIndex, run: Exec = exec, limit = 100): Promise<FileItem[]> {
  const hits = await searchFiles(
    query,
    async (command) => {
      const outcome = await run(command);
      return outcome.ok ? outcome.stdout : null;
    },
    home,
    limit,
  );
  const items = await Promise.all(hits.map(async (hit) => ({ hit, item: await itemAt(hit.path, index) })));
  return items.flatMap(({ hit, item }) => (item ? [{ ...item, where: hit.folder }] : []));
}
