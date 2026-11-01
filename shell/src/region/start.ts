/**
 * Wires time zone, language, and region formats into the running shell:
 * the system's time zone (timedated) becomes the process's, so every clock
 * reads it; the person's clock and region settings (settings.json) become
 * the clocks' preferences and the formats of programs started from now on.
 */

import { clockPrefs, clockPrefsFrom } from "../clock.ts";
import type { SettingsStore } from "../settings-app/store.ts";
import type { RegionBackend } from "./backend.ts";
import { applyFormats, type FormatsDeps } from "./formats.ts";
import { RegionStore } from "./store.ts";

export interface RegionRuntime {
  store: RegionStore;
  close(): void;
}

export interface RegionOptions {
  settings: SettingsStore;
  backend: RegionBackend;
  /** Where the next-login file goes; the real one unless a test says otherwise. */
  formats?: FormatsDeps;
  env?: Readonly<Record<string, string | undefined>>;
}

export function startRegion(options: RegionOptions): RegionRuntime {
  const { settings } = options;
  const store = new RegionStore(options.backend, {
    applyTimezone: (timezone) => {
      if (process.env.TZ === timezone) return;
      process.env.TZ = timezone;
      // The same instant reads differently now: every clock looks again.
      clockPrefs.touch();
    },
  });
  let formats: string | undefined;
  let applied = false;
  const follow = (): void => {
    const data = settings.getSnapshot().data;
    clockPrefs.set(clockPrefsFrom(data, options.env));
    if (applied && data.region.formats === formats) return;
    applied = true;
    formats = data.region.formats;
    applyFormats(formats, options.formats);
  };
  follow();
  const stopFollowing = settings.subscribe(follow);
  // A hand edit of settings.json shows up in the clocks too.
  const stopWatching = settings.watch();
  void store.start().catch((error) => console.error("dashi-shell: could not read the time zone and language:", error instanceof Error ? error.message : error));
  return {
    store,
    close() {
      stopFollowing();
      stopWatching();
      store.close();
    },
  };
}
