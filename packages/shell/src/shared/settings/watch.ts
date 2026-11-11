/** Following the settings file: the shell applies it again (settings/settings.ts), the portal tells apps (apps/portal/lib/look.ts). */

import { mkdirSync, watch } from "node:fs";
import { basename, dirname } from "node:path";

/** Editors save by writing, renaming, or replacing; wait for the dust to settle. */
const SETTLE_MS = 150;

/**
 * Call `onChange` when the file changes. Watches the directory, since the
 * file may be replaced or not exist yet. On a fresh install the directory
 * does not exist either, and watching it would fail: it is created first, so
 * the first write (System Settings') is applied without a restart. If it
 * cannot be created there is nothing to watch and the settings are read at
 * startup only.
 */
export function watchSettings(path: string, onChange: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    mkdirSync(dirname(path), { recursive: true });
    const watcher = watch(dirname(path), (_event, name) => {
      if (name && name !== basename(path)) return;
      clearTimeout(timer);
      timer = setTimeout(onChange, SETTLE_MS);
    });
    watcher.on("error", () => {});
    return () => {
      clearTimeout(timer);
      watcher.close();
    };
  } catch {
    return () => {};
  }
}
