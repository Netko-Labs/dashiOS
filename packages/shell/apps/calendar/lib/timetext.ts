/** Times and days as people type them: the event sheet's fields and quick add (quickadd.ts). */

import { type Day, isDay } from "../../../src/shared/calendar/index.ts";

/**
 * A time typed as people write it: "14:30", "2:30 pm", "2pm", "930", "9.30 a.m.", "noon" → minutes after midnight, or null.
 * Without AM or PM a time is read as written, except in a 12-hour region (`hour12`), where 1 to 6 is the afternoon's
 * (a bare "3" is 3 PM, the next 3 o'clock in working hours; "7" is still 7 AM).
 */
export function parseTimeText(text: string, hour12 = false): number | null {
  const words = text.trim().toLowerCase();
  if (words === "noon") return 12 * 60;
  if (words === "midnight") return 0;
  const match = /^\s*(\d{1,2})(?:[:.]?(\d{2}))?\s*([ap])?\.?\s*(?:m\.?)?\s*$/i.exec(text.replace(/ /g, " "));
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = match[2] === undefined ? 0 : Number(match[2]);
  const meridiem = match[3]?.toLowerCase();
  if (minute > 59) return null;
  if (meridiem !== undefined) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (meridiem === "p" ? 12 : 0);
  } else if (hour > 23) return null;
  else if (hour12 && hour >= 1 && hour <= 6) hour += 12;
  return hour * 60 + minute;
}

export type DateOrder = "ymd" | "mdy" | "dmy";

/** The order a region writes a date's parts in ("mdy" for en-US, "dmy" for de-DE or en-GB, "ymd" for ja-JP or sv-SE). */
export function dateOrder(locale: string): DateOrder {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat(locale, { year: "numeric", month: "numeric", day: "numeric", timeZone: "UTC" }).formatToParts(new Date(0));
  } catch {
    return "mdy";
  }
  const order = parts
    .filter((part) => part.type === "year" || part.type === "month" || part.type === "day")
    .map((part) => part.type[0])
    .join("");
  return order === "ymd" || order === "dmy" ? order : "mdy";
}

/**
 * A day typed as 2026-11-05 (also with / or .), or as the region writes it
 * (11/5/2026 in the US, 5.11.2026 in Germany), the year optional (this one,
 * `thisYear`) and two digits read as 20xx. Null when it is not a real day.
 */
export function parseDayText(text: string, order: DateOrder = "ymd", thisYear: number = new Date().getFullYear()): Day | null {
  const iso = /^\s*(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\s*$/.exec(text);
  let year: number;
  let month: number;
  let day: number;
  if (iso) [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else {
    const local = /^\s*(\d{1,2})[-/. ](\d{1,2})(?:[-/. ](\d{2}|\d{4}))?\s*\.?\s*$/.exec(text);
    if (!local || order === "ymd") return null;
    const [first, second] = [Number(local[1]), Number(local[2])];
    [month, day] = order === "mdy" ? [first, second] : [second, first];
    year = local[3] === undefined ? thisYear : local[3].length === 2 ? 2000 + Number(local[3]) : Number(local[3]);
  }
  const value = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return isDay(value) ? value : null;
}

/** A day as the region writes it in a field: "11/5/2026", "5.11.2026", "2026-11-05". */
export function formatDayText(day: Day, locale: string): string {
  const [year, month, date] = [Number(day.slice(0, 4)), Number(day.slice(5, 7)), Number(day.slice(8, 10))];
  try {
    return new Intl.DateTimeFormat(locale, { year: "numeric", month: "numeric", day: "numeric", timeZone: "UTC" }).format(
      new Date(Date.UTC(year, month - 1, date)),
    );
  } catch {
    return day;
  }
}
