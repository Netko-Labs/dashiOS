/**
 * What a region's formats look like, for the Language & Region pane's
 * preview: a date, a time, a number, and the days of the week starting on
 * the person's first day. Pure.
 */

import { type ClockPrefs, formatLongDay, formatTime } from "../clock.ts";

export type FirstWeekday = "sunday" | "monday" | "saturday";

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
