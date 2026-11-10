/**
 * Date, time, and region as agents reach them: the same store System
 * Settings' panes use and the same settings.json keys, so what an agent
 * changes is what the person sees there. Nothing here takes a password: a
 * write that needs one goes through polkit, whose sheet is the person's
 * (the shell's authentication agent), and an agent only hears whether it was
 * accepted.
 */

import type { SettingsStore } from "../settings-app/store.ts";
import { isFormatsLocale } from "../shared/locale/locale.ts";
import { clockPrefsFrom, usesHour24 } from "../shared/time/clock.ts";
import type { RegionFailure } from "./lib/backend.ts";
import type { RegionStore } from "./store.ts";
import { isTimezoneName } from "./timezones.ts";

export interface RegionReading {
  timeZone: string;
  setTimeAutomatically: boolean;
  clock24Hour: boolean;
  /** Whether 24-hour time is the person's choice (false: it follows the region). */
  clock24HourChosen: boolean;
  showDateInMenuBar: boolean;
  language: string | null;
  /** The locale dates, times, and numbers follow; null when they follow the language. */
  regionFormats: string | null;
  firstWeekday: string | null;
  /** The locales that can be named for the formats. */
  installedLocales: string[];
}

export interface RegionDesktop {
  read(): RegionReading;
  /** Why it did not happen, or null; resolves after the person has answered any password sheet. */
  setTimeZone(timeZone: string): Promise<RegionFailure | "unknown" | null>;
  setClock24Hour(on: boolean): void;
  /** null puts the formats back to following the language. Returns false for a locale that is not installed. */
  setRegionFormats(locale: string | null): boolean;
}

export function regionDesktop(region: RegionStore, settings: SettingsStore, env: Readonly<Record<string, string | undefined>> = process.env): RegionDesktop {
  return {
    read() {
      const state = region.getSnapshot();
      const data = settings.getSnapshot().data;
      return {
        timeZone: state.timezone,
        setTimeAutomatically: state.ntp,
        clock24Hour: usesHour24(clockPrefsFrom(data, env)),
        clock24HourChosen: data.clock.hour24 !== undefined,
        showDateInMenuBar: data.clock.showDate ?? true,
        language: state.language,
        regionFormats: data.region.formats ?? null,
        firstWeekday: data.region.firstWeekday ?? null,
        installedLocales: state.locales.map((entry) => entry.id),
      };
    },
    async setTimeZone(timeZone) {
      const { zones } = region.getSnapshot();
      // The system's own list when it has one; the name's shape alone otherwise.
      if (!isTimezoneName(timeZone) || (zones.length > 0 && !zones.some((zone) => zone.id === timeZone))) return "unknown";
      return region.setTimezone(timeZone);
    },
    setClock24Hour(on) {
      settings.patch("clock", { hour24: on });
    },
    setRegionFormats(locale) {
      if (locale === null) {
        settings.patch("region", { formats: undefined });
        return true;
      }
      const { locales } = region.getSnapshot();
      if (!isFormatsLocale(locale) || (locales.length > 0 && !locales.some((entry) => entry.id === locale))) return false;
      settings.patch("region", { formats: locale });
      return true;
    },
  };
}
