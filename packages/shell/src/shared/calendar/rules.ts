/**
 * RRULE text (RFC 5545 3.3.10) and the `Repeat` Calendar keeps. Read: FREQ,
 * INTERVAL, COUNT or UNTIL, BYDAY (weekdays; with an ordinal, "1MO" or
 * "-1FR", for a monthly or yearly), BYMONTHDAY, BYMONTH (yearly), BYSETPOS,
 * and WKST=MO. Anything else (BYWEEKNO, BYYEARDAY, hourly) is not a repeat
 * Calendar can show: the event shows once and its rule is kept as written.
 */

import { fromBasicDay, fromBasicLocal, toBasicDay, toBasicLocal } from "./dates.ts";
import { FREQUENCIES, type Frequency, type NthDay, type Repeat } from "./types.ts";
import { convertWall, hereZone, isZone, UTC } from "./zones.ts";

export const WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;

/** A comma list of whole numbers within [-max, max] and not 0; null when any is not. */
function numbers(text: string, max: number, allowNegative: boolean): number[] | null {
  const out: number[] = [];
  for (const part of text.split(",")) {
    if (!/^[+-]?\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    if (value === 0 || Math.abs(value) > max || (value < 0 && !allowNegative)) return null;
    out.push(value);
  }
  return out.length === 0 ? null : [...new Set(out)];
}

/** BYDAY as plain weekdays and nth weekdays; null when a token is not one. */
function weekdays(text: string): { plain: number[]; nth: NthDay[] } | null {
  const plain: number[] = [];
  const nth: NthDay[] = [];
  for (const token of text.split(",")) {
    const match = /^([+-]?\d{1,2})?([A-Za-z]{2})$/.exec(token);
    const day = match ? WEEKDAYS.indexOf((match[2] ?? "").toUpperCase() as (typeof WEEKDAYS)[number]) : -1;
    if (!match || day < 0) return null;
    if (match[1] === undefined) plain.push(day);
    else {
      const n = Number(match[1]);
      if (n === 0 || Math.abs(n) > 5) return null;
      nth.push({ n, day });
    }
  }
  return { plain: [...new Set(plain)].sort((a, b) => a - b), nth };
}

/**
 * The rule as a Repeat, or null when it uses anything Calendar does not show.
 * `zone` is the event's: a UNTIL in UTC is the day it is there.
 */
export function parseRule(value: string, zone: string | null = null): Repeat | null {
  const fields = new Map<string, string>();
  for (const part of value.split(";")) {
    const equals = part.indexOf("=");
    if (equals <= 0) return null;
    const key = part.slice(0, equals).toUpperCase();
    if (fields.has(key)) return null;
    fields.set(key, part.slice(equals + 1));
  }
  const allowed = new Set(["FREQ", "INTERVAL", "COUNT", "UNTIL", "BYDAY", "BYMONTHDAY", "BYMONTH", "BYSETPOS", "WKST"]);
  if ([...fields.keys()].some((key) => !allowed.has(key))) return null;
  const freq = fields.get("FREQ")?.toLowerCase();
  if (!(FREQUENCIES as readonly string[]).includes(freq ?? "")) return null;
  const repeat: Repeat = { freq: freq as Frequency, interval: 1 };
  const interval = fields.get("INTERVAL");
  if (interval !== undefined) {
    if (!/^\d{1,3}$/.test(interval) || Number(interval) < 1) return null;
    repeat.interval = Number(interval);
  }
  if (fields.has("COUNT") && fields.has("UNTIL")) return null;
  const count = fields.get("COUNT");
  if (count !== undefined) {
    if (!/^\d{1,4}$/.test(count) || Number(count) < 1) return null;
    repeat.count = Number(count);
  }
  const until = fields.get("UNTIL");
  if (until !== undefined) {
    const wall = /^\d{8}$/.test(until) ? null : fromBasicLocal(until.replace(/Z$/, ""));
    const day = /^\d{8}$/.test(until)
      ? fromBasicDay(until)
      : wall === null
        ? null
        : (until.endsWith("Z") ? convertWall(wall, UTC, zone ?? hereZone()) : wall).slice(0, 10);
    if (day === null) return null;
    repeat.until = day;
  }
  const byDay = fields.get("BYDAY");
  if (byDay !== undefined) {
    const days = weekdays(byDay);
    if (!days) return null;
    if (repeat.freq === "weekly" || repeat.freq === "daily") {
      // A daily on some weekdays is a weekly on them (every weekday is FREQ=DAILY;BYDAY=MO,…,FR in some files).
      if (days.nth.length > 0 || (repeat.freq === "daily" && repeat.interval > 1)) return null;
      repeat.freq = "weekly";
    } else if (days.nth.length > 0 && days.plain.length > 0) return null;
    if (days.plain.length > 0) repeat.byDay = days.plain;
    if (days.nth.length > 0) repeat.byNth = days.nth;
  }
  const monthDay = fields.get("BYMONTHDAY");
  if (monthDay !== undefined) {
    if (repeat.freq !== "monthly" && repeat.freq !== "yearly") return null;
    const days = numbers(monthDay, 31, true);
    if (!days) return null;
    repeat.byMonthDay = days.sort((a, b) => a - b);
  }
  const month = fields.get("BYMONTH");
  if (month !== undefined) {
    if (repeat.freq !== "yearly") return null;
    const months = numbers(month, 12, false);
    if (!months) return null;
    repeat.byMonth = months.sort((a, b) => a - b);
  }
  // A yearly on weekdays or days of the month is within the months it names.
  if (repeat.freq === "yearly" && repeat.byMonth === undefined && (repeat.byDay || repeat.byNth || repeat.byMonthDay)) return null;
  const setPos = fields.get("BYSETPOS");
  if (setPos !== undefined) {
    if (repeat.freq !== "monthly" && repeat.freq !== "yearly") return null;
    const positions = numbers(setPos, 366, true);
    if (!positions) return null;
    repeat.bySetPos = positions.sort((a, b) => a - b);
  }
  const wkst = fields.get("WKST");
  if (wkst !== undefined && wkst.toUpperCase() !== "MO" && !(wkst.toUpperCase() === "SU" && (repeat.freq !== "weekly" || repeat.interval === 1))) return null;
  return repeat;
}

/** The rule as RRULE text. A zoned event's UNTIL is the end of its last day there, in UTC (as RFC 5545 asks). */
export function formatRule(repeat: Repeat, allDay: boolean, zone: string | null = null): string {
  const parts = [`FREQ=${repeat.freq.toUpperCase()}`];
  if (repeat.interval > 1) parts.push(`INTERVAL=${repeat.interval}`);
  const days = [...(repeat.byNth ?? []).map(({ n, day }) => `${n}${WEEKDAYS[day]}`), ...(repeat.byDay ?? []).map((index) => WEEKDAYS[index])];
  if (repeat.byMonth && repeat.byMonth.length > 0) parts.push(`BYMONTH=${repeat.byMonth.join(",")}`);
  if (repeat.byMonthDay && repeat.byMonthDay.length > 0) parts.push(`BYMONTHDAY=${repeat.byMonthDay.join(",")}`);
  if (days.length > 0) parts.push(`BYDAY=${days.join(",")}`);
  if (repeat.bySetPos && repeat.bySetPos.length > 0) parts.push(`BYSETPOS=${repeat.bySetPos.join(",")}`);
  if (repeat.count !== undefined) parts.push(`COUNT=${repeat.count}`);
  else if (repeat.until !== undefined) {
    const last = `${repeat.until}T23:59`;
    const utc = !allDay && zone !== null && isZone(zone) ? convertWall(last, zone, UTC) : null;
    parts.push(`UNTIL=${allDay ? toBasicDay(repeat.until) : utc !== null ? `${toBasicLocal(utc).slice(0, 13)}59Z` : `${toBasicDay(repeat.until)}T235959`}`);
  }
  return parts.join(";");
}

/** A repeat the sheet edits as it is: no nth weekdays but a monthly's one, no days of the month, no months, no set positions. */
export function isSimpleRepeat(repeat: Repeat): boolean {
  const nth = repeat.byNth ?? [];
  const monthlyNth = repeat.freq === "monthly" && nth.length === 1 && !repeat.byDay;
  return (nth.length === 0 || monthlyNth) && !repeat.byMonthDay && !repeat.byMonth && !repeat.bySetPos && (repeat.freq === "weekly" || !repeat.byDay);
}
