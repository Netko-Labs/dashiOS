/**
 * The clock: the current time as a React hook, and how the menu bar, the
 * lock screen, and the notification center write it. How it is written is
 * the person's choice (Date & Time and Language & Region in System Settings:
 * 24-hour time, whether the menu bar shows the date, the region's formats),
 * held in `clockPrefs` so every surface of the shell repaints together.
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import { isFormatsLocale, localeFromEnv, toBcp47 } from "../locale/index.ts";
import { isBoolean, isRaw, oneOf, readFields } from "../settings/index.ts";

export interface ClockPrefs {
  /** The BCP 47 tag the formats follow (`de-DE`). */
  locale: string;
  /** 24-hour time on or off; undefined follows the locale. */
  hour24: boolean | undefined;
  /** Whether the menu bar's clock shows the date before the time. */
  showDate: boolean;
  /** The first day of the week the person chose; undefined follows the locale (firstDayIndex). */
  firstWeekday?: "sunday" | "monday" | "saturday";
}

/** Dashi's look before anyone chose anything: US English, 12-hour, with the date. */
export const DEFAULT_CLOCK_PREFS: ClockPrefs = { locale: "en-US", hour24: undefined, showDate: true };

/** The preferences from the person's settings; the process's own locale when they chose no region. */
export function clockPrefsFrom(
  settings: { clock: { hour24?: boolean; showDate?: boolean }; region: { formats?: string; firstWeekday?: "sunday" | "monday" | "saturday" } },
  env: Readonly<Record<string, string | undefined>> = process.env,
): ClockPrefs {
  const named = settings.region.formats ?? localeFromEnv(env);
  return {
    locale: (named ? toBcp47(named) : null) ?? DEFAULT_CLOCK_PREFS.locale,
    hour24: settings.clock.hour24,
    showDate: settings.clock.showDate ?? true,
    ...(settings.region.firstWeekday ? { firstWeekday: settings.region.firstWeekday } : {}),
  };
}

const cache = new Map<string, Intl.DateTimeFormat>();

/**
 * A formatter, made once per locale and options (they are costly to build, and the clock asks every
 * minute). A formatter keeps the time zone it was made in, so the zone is part of the key.
 */
function formatter(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${process.env.TZ ?? ""}|${locale}|${JSON.stringify(options)}`;
  let found = cache.get(key);
  if (!found) {
    try {
      found = new Intl.DateTimeFormat(locale, options);
    } catch {
      found = new Intl.DateTimeFormat(DEFAULT_CLOCK_PREFS.locale, options);
    }
    cache.set(key, found);
  }
  return found;
}

/** Whether the clock reads 24-hour: the choice, else what the locale does. */
export function usesHour24(prefs: ClockPrefs): boolean {
  if (prefs.hour24 !== undefined) return prefs.hour24;
  return formatter(prefs.locale, { hour: "numeric" }).resolvedOptions().hourCycle?.startsWith("h2") === true;
}

const hourOptions = (prefs: ClockPrefs): Intl.DateTimeFormatOptions => ({
  hour: "numeric",
  minute: "2-digit",
  ...(prefs.hour24 === undefined ? {} : { hourCycle: prefs.hour24 ? "h23" : "h12" }),
});

/** "6:05 PM" or "18:05". */
export const formatTime = (date: Date, prefs: ClockPrefs = DEFAULT_CLOCK_PREFS): string => formatter(prefs.locale, hourOptions(prefs)).format(date);

/** "6:05", "18:05": the time without AM or PM, for the lock screen's big numerals. */
export function formatTimeBare(date: Date, prefs: ClockPrefs = DEFAULT_CLOCK_PREFS): string {
  return formatter(prefs.locale, hourOptions(prefs))
    .formatToParts(date)
    .filter((part) => part.type !== "dayPeriod")
    .map((part) => part.value)
    .join("")
    .trim();
}

/** "Thu Oct 29": the menu bar's day. */
export const formatDay = (date: Date, prefs: ClockPrefs = DEFAULT_CLOCK_PREFS): string =>
  formatter(prefs.locale, { weekday: "short", month: "short", day: "numeric" }).format(date).replace(",", "");

/** "Thursday, October 29": the lock screen's day. */
export const formatLongDay = (date: Date, prefs: ClockPrefs = DEFAULT_CLOCK_PREFS): string =>
  formatter(prefs.locale, { weekday: "long", month: "long", day: "numeric" }).format(date);

/** macOS's menu bar clock: "Wed Oct 29  6:45 PM", or just the time when the date is off. */
export function formatClock(date: Date, prefs: ClockPrefs = DEFAULT_CLOCK_PREFS): string {
  return prefs.showDate ? `${formatDay(date, prefs)}  ${formatTime(date, prefs)}` : formatTime(date, prefs);
}

/** The preferences as a store, so a change repaints every clock at once. */
export class ClockPrefsStore {
  private snapshot: ClockPrefs = DEFAULT_CLOCK_PREFS;
  private readonly listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): ClockPrefs => this.snapshot;

  /** Tell the clocks to read the time again without changing how they write it (the time zone moved). */
  touch(): void {
    for (const listener of this.listeners) listener();
  }

  set(next: ClockPrefs): void {
    const { locale, hour24, showDate } = this.snapshot;
    if (next.locale === locale && next.hour24 === hour24 && next.showDate === showDate) return;
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
}

/** The shell's one set of preferences (main.tsx feeds it from settings.json). */
export const clockPrefs = new ClockPrefsStore();

export const useClockPrefs = (): ClockPrefs => useSyncExternalStore(clockPrefs.subscribe, clockPrefs.getSnapshot);

/** The current time, re-rendered once a minute on the minute. */
export function useMinuteClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const current = new Date();
      const untilNextMinute = 60_000 - (current.getSeconds() * 1000 + current.getMilliseconds());
      timer = setTimeout(() => {
        setNow(new Date());
        schedule();
      }, untilNextMinute + 20);
    };
    schedule();
    return () => clearTimeout(timer);
  }, []);
  // A new time zone changes what the same instant reads: look again.
  useEffect(() => clockPrefs.subscribe(() => setNow(new Date())), []);
  return now;
}

// What a region's formats look like, for the Language & Region pane's
// preview: a date, a time, a number, and the days of the week starting on
// the person's first day. Pure.

export const WEEKDAYS = ["sunday", "monday", "saturday"] as const;
export type FirstWeekday = (typeof WEEKDAYS)[number];

const INDEX: Record<FirstWeekday, number> = { sunday: 0, monday: 1, saturday: 6 };

/** The region's own first day (0 Sunday … 6 Saturday); Monday when ICU does not say. */
export function localeFirstDay(locale: string): number {
  try {
    const info = new Intl.Locale(locale) as { getWeekInfo?: () => { firstDay: number }; weekInfo?: { firstDay: number } };
    const first = (info.getWeekInfo?.() ?? info.weekInfo)?.firstDay;
    // ICU counts 1 Monday … 7 Sunday.
    return typeof first === "number" ? first % 7 : 1;
  } catch {
    return 1;
  }
}

/** The first day of the week as 0 (Sunday) to 6 (Saturday): the person's choice, else the region's. */
export const firstDayIndex = (locale: string, choice: FirstWeekday | undefined): number => (choice ? INDEX[choice] : localeFirstDay(locale));

/** The seven days' short names, the first day first ("Mon Tue …"). */
export function weekdayNames(locale: string, firstDay: number): string[] {
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" });
  } catch {
    format = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });
  }
  // 2023-01-01 was a Sunday.
  return Array.from({ length: 7 }, (_, offset) => format.format(new Date(Date.UTC(2023, 0, 1 + ((firstDay + offset) % 7)))));
}

export interface FormatPreview {
  date: string;
  time: string;
  number: string;
}

export function previewFormats(prefs: ClockPrefs, now: Date): FormatPreview {
  let number: string;
  try {
    number = new Intl.NumberFormat(prefs.locale).format(1234567.89);
  } catch {
    number = new Intl.NumberFormat("en-US").format(1234567.89);
  }
  return { date: formatLongDay(now, prefs), time: formatTime(now, prefs), number };
}

// The `clock` and `region` sections: how the person writes times and dates.
// System Settings writes them (settings-app/store.ts holds them in its sections);
// Calendar and Calculator read them from the file.

/** `clock`: how the menu bar, the lock screen, and the notification center write the time. */
export interface ClockSettings {
  /** 24-hour time on or off; the region's own habit when not set. */
  hour24?: boolean;
  /** The date in the menu bar; on when not set. */
  showDate?: boolean;
}

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
