/**
 * Calendar days and wall-clock times as plain strings, so nothing depends on
 * the time zone the process runs in until a real instant is needed.
 *
 * A `Day` is "2026-11-05". A `Local` is "2026-11-05T14:30": a wall-clock time
 * with no zone ("floating", RFC 5545 form 1), which is how Calendar stores
 * every event. Arithmetic on both is done in UTC so a daylight-saving change
 * never shifts a day. Strings of one kind sort the way the times do.
 */

export type Day = string;
export type Local = string;

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

const pad = (n: number, width = 2): string => String(n).padStart(width, "0");

export const MINUTE = 60_000;
export const DAY_MINUTES = 1440;

/** The day as UTC midnight, or null when the string is not a real calendar day. */
function utcOf(year: number, month: number, day: number): number | null {
  const time = Date.UTC(year, month - 1, day);
  const check = new Date(time);
  // Date.UTC wraps 1900-1999 years and overflowing days; refuse both.
  if (year < 1000 || year > 9999 || check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return time;
}

export function isDay(value: unknown): value is Day {
  return typeof value === "string" && parseDay(value) !== null;
}

export function isLocal(value: unknown): value is Local {
  return typeof value === "string" && parseLocal(value) !== null;
}

/** UTC midnight of a day string, or null. */
export function parseDay(day: string): number | null {
  const match = DAY.exec(day);
  return match ? utcOf(Number(match[1]), Number(match[2]), Number(match[3])) : null;
}

/** A wall-clock string as milliseconds counted as if it were UTC, or null. */
export function parseLocal(local: string): number | null {
  const match = LOCAL.exec(local);
  if (!match) return null;
  const base = utcOf(Number(match[1]), Number(match[2]), Number(match[3]));
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  if (base === null || hour > 23 || minute > 59) return null;
  return base + hour * 60 * MINUTE + minute * MINUTE;
}

function dayFromUtc(time: number): Day {
  const date = new Date(time);
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function localFromUtc(time: number): Local {
  const date = new Date(time);
  return `${dayFromUtc(time)}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

/** The day a date falls on in the process's time zone. */
export function dayOf(date: Date): Day {
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The wall-clock time of an instant in the process's time zone. */
export function localOf(date: Date): Local {
  return `${dayOf(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** The instant a wall-clock time is, in the process's time zone (a time skipped by a clock change moves forward). */
export function instantOf(value: Local | Day): Date {
  const match = LOCAL.exec(value) ?? DAY.exec(value);
  if (!match) return new Date(Number.NaN);
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4] ?? 0), Number(match[5] ?? 0));
}

/** The day part of a wall-clock time. */
export const dayPart = (local: Local): Day => local.slice(0, 10);

/** "14:30" of a wall-clock time. */
export const timePart = (local: Local): string => local.slice(11, 16);

/** A wall-clock time on a day, from minutes after midnight. */
export const at = (day: Day, minutes: number): Local => addMinutes(`${day}T00:00`, minutes);

/** Minutes after midnight of a wall-clock time. */
export const minuteOfDay = (local: Local): number => Number(local.slice(11, 13)) * 60 + Number(local.slice(14, 16));

export function addDays(day: Day, count: number): Day {
  const time = parseDay(day);
  return time === null ? day : dayFromUtc(time + count * 86_400_000);
}

export function addMinutes(local: Local, minutes: number): Local {
  const time = parseLocal(local);
  return time === null ? local : localFromUtc(time + minutes * MINUTE);
}

/** Whole days from `a` to `b` (negative when b is earlier). */
export function daysBetween(a: Day, b: Day): number {
  const from = parseDay(a);
  const to = parseDay(b);
  return from === null || to === null ? 0 : Math.round((to - from) / 86_400_000);
}

/** Minutes from `a` to `b` on the wall clock. */
export function minutesBetween(a: Local, b: Local): number {
  const from = parseLocal(a);
  const to = parseLocal(b);
  return from === null || to === null ? 0 : Math.round((to - from) / MINUTE);
}

/** 0 Sunday … 6 Saturday. */
export function weekday(day: Day): number {
  const time = parseDay(day);
  return time === null ? 0 : new Date(time).getUTCDay();
}

/** The first day of the week (`firstDay`: 0 Sunday … 6 Saturday) that holds `day`. */
export function startOfWeek(day: Day, firstDay: number): Day {
  return addDays(day, -((weekday(day) - firstDay + 7) % 7));
}

export const monthOf = (day: Day): { year: number; month: number } => ({ year: Number(day.slice(0, 4)), month: Number(day.slice(5, 7)) - 1 });

export const firstOfMonth = (year: number, month: number): Day => dayFromUtc(Date.UTC(year, month, 1));

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/** The day `count` months on, clamped to the month's last day (Jan 31 + 1 month is Feb 28). */
export function addMonths(day: Day, count: number): Day {
  const { year, month } = monthOf(day);
  const index = year * 12 + month + count;
  const y = Math.floor(index / 12);
  const m = ((index % 12) + 12) % 12;
  return dayFromUtc(Date.UTC(y, m, Math.min(Number(day.slice(8, 10)), daysInMonth(y, m))));
}

export function today(now: Date = new Date()): Day {
  return dayOf(now);
}

/** The iCalendar basic forms: 20261105 and 20261105T143000. */
export const toBasicDay = (day: Day): string => day.replaceAll("-", "");
export const toBasicLocal = (local: Local): string => `${local.slice(0, 10).replaceAll("-", "")}T${local.slice(11, 13)}${local.slice(14, 16)}00`;

export function fromBasicDay(text: string): Day | null {
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(text);
  const day = match ? `${match[1]}-${match[2]}-${match[3]}` : "";
  return isDay(day) ? day : null;
}

/** Seconds are dropped: Calendar works in minutes. */
export function fromBasicLocal(text: string): Local | null {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/.exec(text);
  const local = match ? `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}` : "";
  return isLocal(local) ? local : null;
}
