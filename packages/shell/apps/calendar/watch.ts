/**
 * Picks up what happens in the calendars folder while something is looking at
 * it: another program saving an .ics file, a sync tool dropping one in, an
 * agent adding an event. A burst of events becomes one `onChange` after a
 * short quiet. The folder may not exist yet (nothing has been saved): it is
 * looked for again every few seconds, and a change in the folder that appears
 * is reported, since that is the first calendar.
 */

import { existsSync, type FSWatcher, watch } from "node:fs";

export const QUIET_MS = 150;
export const RETRY_MS = 5_000;

/**
 * Calls `onChange` (after a quiet moment) when anything in `root` changes,
 * with the names of the files that did (null when that is not known: the
 * folder appeared, or the system did not say); returns the function that
 * stops watching.
 */
export function watchCalendars(root: string, onChange: (names: ReadonlySet<string> | null) => void, quietMs = QUIET_MS, retryMs = RETRY_MS): () => void {
  let watcher: FSWatcher | null = null;
  let quiet: ReturnType<typeof setTimeout> | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let names: Set<string> | null = new Set();

  const schedule = (_event?: string, name?: string | Buffer | null): void => {
    if (stopped) return;
    if (typeof name === "string" && name !== "") names?.add(name);
    else names = null;
    if (quiet) clearTimeout(quiet);
    quiet = setTimeout(() => {
      quiet = null;
      const changed = names;
      names = new Set();
      if (!stopped) onChange(changed);
    }, quietMs);
  };

  const attach = (): void => {
    if (stopped || watcher) return;
    if (existsSync(root)) {
      try {
        watcher = watch(root, (event, name) => schedule(event, name));
        // A folder that is deleted or moved ends its watcher; look for it again.
        watcher.on("error", () => {
          watcher?.close();
          watcher = null;
          schedule();
          again();
        });
        return;
      } catch {
        // Gone before it could be watched.
      }
    }
    again();
  };

  function again(): void {
    if (stopped || retry) return;
    retry = setTimeout(() => {
      retry = null;
      const was = watcher !== null;
      attach();
      // The folder appeared: whatever is in it is new.
      if (!was && watcher !== null) schedule();
    }, retryMs);
    retry.unref?.();
  }

  attach();
  return () => {
    stopped = true;
    if (quiet) clearTimeout(quiet);
    if (retry) clearTimeout(retry);
    watcher?.close();
    watcher = null;
  };
}
