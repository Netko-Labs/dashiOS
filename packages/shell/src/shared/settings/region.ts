/**
 * The settings file's `clock` and `region` sections: how the person writes
 * times and dates. The shell's clock, Calendar and Calculator read them; System
 * Settings writes them (settings-app/store.ts holds them in its sections).
 */

import { isFormatsLocale } from "../locale/locale.ts";
import { isBoolean, isRaw, oneOf, readFields } from "./fields.ts";

/** `clock`: how the menu bar, the lock screen, and the notification center write the time. */
export interface ClockSettings {
  /** 24-hour time on or off; the region's own habit when not set. */
  hour24?: boolean;
  /** The date in the menu bar; on when not set. */
  showDate?: boolean;
}

export const WEEKDAYS = ["sunday", "monday", "saturday"] as const;
export type FirstWeekday = (typeof WEEKDAYS)[number];

/** `region`: this person's formats, apart from the system language. */
export interface RegionSettings {
  /** The locale dates, times, numbers, and money follow (`de_DE.UTF-8`); the language's own when not set. */
  formats?: string;
  /** The first day of the week; the region's own when not set. */
  firstWeekday?: FirstWeekday;
}

export const CLOCK_SECTION = { path: ["clock"], fields: { hour24: isBoolean, showDate: isBoolean } } as const;
export const REGION_SECTION = { path: ["region"], fields: { formats: isFormatsLocale, firstWeekday: oneOf(...WEEKDAYS) } } as const;

/** The two sections from a decoded settings file. Never throws. */
export function readRegionSettings(raw: unknown): { clock: ClockSettings; region: RegionSettings } {
  const root = isRaw(raw) ? raw : {};
  return {
    clock: readFields(root, CLOCK_SECTION.path, CLOCK_SECTION.fields) as ClockSettings,
    region: readFields(root, REGION_SECTION.path, REGION_SECTION.fields) as RegionSettings,
  };
}
