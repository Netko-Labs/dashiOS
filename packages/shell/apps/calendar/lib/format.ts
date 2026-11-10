/** How Calendar writes days and times: the region's formats and 12 or 24 hour time from Language & Region and Date & Time (clock.ts). */

import { addDays, type Day, dayPart, instantOf, type Local, minuteOfDay, parseDay } from "../../../src/shared/calendar/dates.ts";
import type { CalEvent, NthDay, Repeat } from "../../../src/shared/calendar/types.ts";
import { type ClockPrefs, formatTime, usesHour24, weekdayNames } from "../../../src/shared/time/index.ts";
import type { View } from "./layout.ts";

function format(locale: string, options: Intl.DateTimeFormatOptions, day: Day): string {
  const time = parseDay(day);
  if (time === null) return day;
  try {
    return new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" }).format(new Date(time));
  } catch {
    return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(new Date(time));
  }
}

export const monthTitle = (day: Day, prefs: ClockPrefs): string => format(prefs.locale, { month: "long", year: "numeric" }, day);
export const longDay = (day: Day, prefs: ClockPrefs): string => format(prefs.locale, { weekday: "long", month: "long", day: "numeric", year: "numeric" }, day);
export const shortDay = (day: Day, prefs: ClockPrefs): string => format(prefs.locale, { weekday: "short", month: "short", day: "numeric" }, day);
export const weekdayShort = (day: Day, prefs: ClockPrefs): string => format(prefs.locale, { weekday: "short" }, day);
export const monthDay = (day: Day, prefs: ClockPrefs): string => format(prefs.locale, { month: "short", day: "numeric" }, day);
export const dayNumber = (day: Day): string => String(Number(day.slice(8, 10)));

/** "Nov 1 – 7, 2026" for a week; without the year, "Nov 1 – 7". */
export function weekTitle(days: readonly Day[], prefs: ClockPrefs, withYear = true): string {
  const first = parseDay(days[0] ?? "");
  const last = parseDay(days[days.length - 1] ?? "");
  if (first === null || last === null) return "";
  const options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", ...(withYear ? { year: "numeric" as const } : {}), timeZone: "UTC" };
  try {
    return new Intl.DateTimeFormat(prefs.locale, options).formatRange(new Date(first), new Date(last));
  } catch {
    return new Intl.DateTimeFormat("en-US", options).formatRange(new Date(first), new Date(last));
  }
}

/** The title over a view in a narrow window: "Nov 2026", "Nov 1 – 7", "Wed, Nov 4". */
export function shortViewTitle(view: View, anchor: Day, days: readonly Day[], prefs: ClockPrefs): string {
  if (view === "month") return format(prefs.locale, { month: "short", year: "numeric" }, anchor);
  if (view === "week") return weekTitle(days, prefs, false);
  return shortDay(anchor, prefs);
}

/** The title over a view. */
export function viewTitle(view: View, anchor: Day, days: readonly Day[], prefs: ClockPrefs): string {
  if (view === "month") return monthTitle(anchor, prefs);
  if (view === "week") return weekTitle(days, prefs);
  return longDay(anchor, prefs);
}

/** "9:30 AM" or "09:30" for a wall-clock time. */
export const clock = (local: Local, prefs: ClockPrefs): string => formatTime(instantOf(local), prefs);

/** "9:30a", "12p", or "09:30": a time in little room (a month cell). */
export function clockShort(local: Local, prefs: ClockPrefs): string {
  if (usesHour24(prefs)) return `${local.slice(11, 13)}:${local.slice(14, 16)}`;
  const hours = Number(local.slice(11, 13));
  const minutes = local.slice(14, 16);
  return `${hours % 12 === 0 ? 12 : hours % 12}${minutes === "00" ? "" : `:${minutes}`}${hours < 12 ? "a" : "p"}`;
}

/** "9 AM" or "09:00" for the hour labels down the time grid. */
export function hourLabel(hour: number, prefs: ClockPrefs): string {
  if (usesHour24(prefs)) return `${String(hour).padStart(2, "0")}:00`;
  if (hour === 0) return "12 AM";
  if (hour === 12) return "Noon";
  return `${hour % 12} ${hour < 12 ? "AM" : "PM"}`;
}

/** "9:00 AM – 10:30 AM", "All day", or "Nov 5, 9:00 AM – Nov 6, 8:00 AM" for an event happening from `start` to `end`. */
export function timeSpan(event: Pick<CalEvent, "allDay">, start: Local, end: Local, prefs: ClockPrefs): string {
  if (event.allDay) {
    const last = addDays(dayPart(end), -1);
    return last > dayPart(start) ? `${shortDay(dayPart(start), prefs)} – ${shortDay(last, prefs)}` : "All day";
  }
  if (dayPart(end) !== dayPart(start))
    return `${shortDay(dayPart(start), prefs)}, ${clock(start, prefs)} – ${shortDay(dayPart(end), prefs)}, ${clock(end, prefs)}`;
  return end === start ? clock(start, prefs) : `${clock(start, prefs)} – ${clock(end, prefs)}`;
}

/** The minutes a start is after midnight, for placing the "now" line. */
export const minutesOf = (local: Local): number => minuteOfDay(local);

/** Alert choices, as the sheet lists them: [minutes before, label]. */
export const TIMED_ALERTS: ReadonlyArray<readonly [number | null, string]> = [
  [null, "None"],
  [0, "At time of event"],
  [5, "5 minutes before"],
  [15, "15 minutes before"],
  [30, "30 minutes before"],
  [60, "1 hour before"],
  [1440, "1 day before"],
];

/** The same for an all-day event: alerts fire at 9 AM of the day (the trigger counts from midnight). */
export const ALL_DAY_ALERTS: ReadonlyArray<readonly [number | null, string]> = [
  [null, "None"],
  [-540, "On the day (9 AM)"],
  [900, "1 day before (9 AM)"],
  [2340, "2 days before (9 AM)"],
];

export function alertLabel(minutes: number | null, allDay: boolean): string {
  const choices = allDay ? ALL_DAY_ALERTS : TIMED_ALERTS;
  const found = choices.find(([value]) => value === minutes);
  if (found) return found[1];
  if (minutes === null) return "None";
  if (minutes < 0) return `${-minutes} minutes after`;
  if (minutes % 1440 === 0) return `${minutes / 1440} days before`;
  if (minutes % 60 === 0) return `${minutes / 60} hours before`;
  return `${minutes} minutes before`;
}

const ORDINALS: Readonly<Record<number, string>> = { 1: "first", 2: "second", 3: "third", 4: "fourth", 5: "fifth", [-1]: "last", [-2]: "second to last" };
const UNIT: Readonly<Record<Repeat["freq"], string>> = { daily: "day", weekly: "week", monthly: "month", yearly: "year" };

/** "the first Monday" of a month. */
export const nthName = (nth: NthDay, prefs: ClockPrefs): string => `the ${ORDINALS[nth.n] ?? `${nth.n}th`} ${weekdayLong(nth.day, prefs)}`;

/** A weekday's long name (0 Sunday … 6 Saturday). */
export function weekdayLong(day: number, prefs: ClockPrefs): string {
  // 2023-01-01 was a Sunday.
  return format(prefs.locale, { weekday: "long" }, `2023-01-${String(day + 1).padStart(2, "0")}`);
}

/** "Every week on Mon, Thu", "Every 2 months on the first Monday", "Custom repeat"; null when it does not repeat. */
export function repeatSummary(event: Pick<CalEvent, "repeat" | "rawRule">, prefs: ClockPrefs): string | null {
  const repeat = event.repeat;
  if (!repeat) return event.rawRule !== null ? "Custom repeat" : null;
  const every = repeat.interval === 1 ? `Every ${UNIT[repeat.freq]}` : `Every ${repeat.interval} ${UNIT[repeat.freq]}s`;
  const names = weekdayNames(prefs.locale, 0);
  const on = [
    ...(repeat.byNth ?? []).map((nth) => nthName(nth, prefs)),
    ...(repeat.freq === "weekly" ? (repeat.byDay ?? []).map((day) => names[day] ?? "") : []),
  ];
  const ends = repeat.count !== undefined ? `, ${repeat.count} times` : repeat.until !== undefined ? `, until ${monthDay(repeat.until, prefs)}` : "";
  const simple = !repeat.byMonthDay && !repeat.byMonth && !repeat.bySetPos && (repeat.freq === "weekly" || !repeat.byDay);
  if (!simple) return `${every}, custom${ends}`;
  return `${every}${on.length > 0 ? ` on ${on.join(", ")}` : ""}${ends}`;
}

/** What an event is called in a list: an event with no title (a file from elsewhere) is not a blank line. */
export const titleOf = (event: Pick<CalEvent, "title">): string => (event.title.trim() === "" ? "(No title)" : event.title);
