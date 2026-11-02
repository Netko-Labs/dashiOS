/** Sizes of folders, worked out in the background when asked (Get Info, the footer), cancellable, never through a link. */

import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";

export interface Measure {
  /** Apparent size of every file, bytes. */
  bytes: number;
  files: number;
  folders: number;
  /** Entries that couldn't be read (permission, vanished). */
  unreadable: number;
}

/**
 * Walks `path` with lstat: a symlink counts as itself, a folder is entered,
 * and entries that can't be read are counted aside. `onProgress` hears about
 * the running totals about every `every` entries. Stops (returning what it
 * has, `cancelled` true) when `signal` aborts.
 */
export async function measure(
  path: string,
  signal?: AbortSignal,
  onProgress?: (so_far: Measure) => void,
  every = 500,
): Promise<Measure & { cancelled: boolean }> {
  const total: Measure = { bytes: 0, files: 0, folders: 0, unreadable: 0 };
  let seen = 0;
  const stack: string[] = [path];
  while (stack.length > 0) {
    if (signal?.aborted) return { ...total, cancelled: true };
    const current = stack.pop() as string;
    let info: Awaited<ReturnType<typeof lstat>>;
    try {
      info = await lstat(current);
    } catch {
      total.unreadable++;
      continue;
    }
    if (info.isDirectory()) {
      total.folders++;
      try {
        for (const name of await readdir(current)) stack.push(join(current, name));
      } catch {
        total.unreadable++;
      }
    } else {
      total.files++;
      total.bytes += info.isFile() ? info.size : 0;
    }
    if (++seen % every === 0) {
      onProgress?.({ ...total });
      // Let the window draw between batches.
      await Bun.sleep(0);
    }
  }
  return { ...total, cancelled: false };
}
