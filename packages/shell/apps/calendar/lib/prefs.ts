/**
 * How the person writes dates and times, from System Settings' Language &
 * Region and Date & Time (`~/.config/dashi/settings.json`, the file the shell
 * reads too): the region's formats, 12 or 24 hour time, and the first day of
 * the week. The app is its own process, so it reads the file and looks at it
 * again every few seconds.
 */

import { readFileSync, statSync } from "node:fs";
import { useEffect, useState } from "react";
import { settingsPath } from "../../../src/shared/settings/file.ts";
import { type ClockPrefs, clockPrefsFrom, DEFAULT_CLOCK_PREFS, firstDayIndex, readRegionSettings } from "../../../src/shared/time/clock.ts";

export interface RegionPrefs {
  clock: ClockPrefs;
  /** 0 Sunday … 6 Saturday. */
  firstDay: number;
}

export const DEFAULT_PREFS: RegionPrefs = { clock: DEFAULT_CLOCK_PREFS, firstDay: firstDayIndex(DEFAULT_CLOCK_PREFS.locale, undefined) };

/** The preferences in a settings file; the defaults when it is missing or unreadable. */
export function readPrefs(path: string = settingsPath(), env: Readonly<Record<string, string | undefined>> = process.env): RegionPrefs {
  try {
    const data = readRegionSettings(JSON.parse(readFileSync(path, "utf8")));
    const clock = clockPrefsFrom(data, env);
    return { clock, firstDay: firstDayIndex(clock.locale, clock.firstWeekday) };
  } catch {
    const clock = clockPrefsFrom({ clock: {}, region: {} }, env);
    return { clock, firstDay: firstDayIndex(clock.locale, undefined) };
  }
}

const POLL_MS = 3_000;

export function useRegionPrefs(path: string = settingsPath()): RegionPrefs {
  const [prefs, setPrefs] = useState(() => readPrefs(path));
  useEffect(() => {
    let stamp = "";
    const look = (): void => {
      let next = "";
      try {
        const stat = statSync(path);
        next = `${stat.mtimeMs}:${stat.size}`;
      } catch {
        next = "";
      }
      if (next === stamp) return;
      stamp = next;
      const read = readPrefs(path);
      setPrefs((old) => (JSON.stringify(old) === JSON.stringify(read) ? old : read));
    };
    look();
    const timer = setInterval(look, POLL_MS);
    return () => clearInterval(timer);
  }, [path]);
  return prefs;
}
