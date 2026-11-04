/**
 * When events happen: a repeating event expanded over a range of wall-clock
 * time. Daily, weekly (with weekdays), monthly (the start's day of the month;
 * months without it are skipped, as RFC 5545 has it), and yearly, every N
 * periods, stopping after COUNT occurrences or on UNTIL; deleted occurrences
 * (EXDATE) are left out. Times are wall-clock strings (dates.ts), so a clock
 * change never moves a daily 9:00 to 8:00.
 */

import {
  addDays,
  addMinutes,
  type Day,
  dayPart,
  daysBetween,
  daysInMonth,
  firstOfMonth,
  type Local,
  minutesBetween,
  monthOf,
  startOfWeek,
  weekday,
} from "./dates.ts";
import type { CalEvent, Calendar, Occurrence, Repeat } from "./types.ts";

/** The most occurrences one expansion yields; a rule that goes on past this is cut. */
export const MAX_OCCURRENCES = 5_000;
/** The most candidate occurrences stepped through for one event (a COUNT of thousands starts at the beginning). */
const MAX_STEPS = 50_000;

/** The starts of a repeat, ascending, beginning with the period `first`. */
function* starts(startsAt: Local, repeat: Repeat, first: number): Generator<Local> {
  const startDay = dayPart(startsAt);
  const time = startsAt.slice(10);
  const { interval } = repeat;
  const begin = monthOf(startDay);
  const dom = Number(startDay.slice(8, 10));
  const weekBase = startOfWeek(startDay, 1);
  const weekdays = (repeat.byDay && repeat.byDay.length > 0 ? repeat.byDay : [weekday(startDay)]).map((index) => (index + 6) % 7).sort((a, b) => a - b);
  for (let i = first; i < first + MAX_STEPS; i++) {
    switch (repeat.freq) {
      case "daily":
        yield `${addDays(startDay, i * interval)}${time}`;
        break;
      case "weekly": {
        const week = addDays(weekBase, 7 * interval * i);
        for (const offset of weekdays) {
          const day = addDays(week, offset);
          if (day >= startDay) yield `${day}${time}`;
        }
        break;
      }
      case "monthly": {
        const index = begin.year * 12 + begin.month + i * interval;
        const year = Math.floor(index / 12);
        const month = index % 12;
        if (dom <= daysInMonth(year, month)) yield `${addDays(firstOfMonth(year, month), dom - 1)}${time}`;
        break;
      }
      case "yearly": {
        const year = begin.year + i * interval;
        if (dom <= daysInMonth(year, begin.month)) yield `${addDays(firstOfMonth(year, begin.month), dom - 1)}${time}`;
        break;
      }
    }
  }
}

/** Which period of the repeat to start from so nothing that reaches `target` is missed. */
function firstPeriod(startsAt: Local, repeat: Repeat, target: Day): number {
  const startDay = dayPart(startsAt);
  if (target <= startDay) return 0;
  const { interval } = repeat;
  switch (repeat.freq) {
    case "daily":
      return Math.max(0, Math.floor(daysBetween(startDay, target) / interval) - 1);
    case "weekly":
      return Math.max(0, Math.floor(daysBetween(startOfWeek(startDay, 1), target) / (7 * interval)) - 1);
    case "monthly": {
      const from = monthOf(startDay);
      const to = monthOf(target);
      return Math.max(0, Math.floor((to.year * 12 + to.month - (from.year * 12 + from.month)) / interval) - 1);
    }
    case "yearly":
      return Math.max(0, Math.floor((monthOf(target).year - monthOf(startDay).year) / interval) - 1);
  }
}

/** Every time `event` happens that overlaps the wall-clock range [from, to). */
export function occurrencesOf(event: CalEvent, calendarId: string, from: Local, to: Local, limit = MAX_OCCURRENCES): Occurrence[] {
  const duration = minutesBetween(event.start, event.end);
  const reaches = (start: Local, end: Local): boolean => (end > start ? end > from && start < to : start >= from && start < to);
  const make = (start: Local): Occurrence => ({ event, calendarId, start, end: addMinutes(start, duration) });
  const repeat = event.repeat;
  if (!repeat) return reaches(event.start, event.end) ? [make(event.start)] : [];

  const out: Occurrence[] = [];
  const skipped = new Set(event.exdates);
  const spanDays = Math.ceil(duration / 1440) + 1;
  // A COUNT is counted from the first occurrence, so it cannot jump ahead.
  const first = repeat.count === undefined ? firstPeriod(event.start, repeat, addDays(dayPart(from), -spanDays)) : 0;
  let produced = 0;
  for (const start of starts(event.start, repeat, first)) {
    if (start >= to || (repeat.until !== undefined && dayPart(start) > repeat.until)) break;
    produced++;
    if (repeat.count !== undefined && produced > repeat.count) break;
    if (skipped.has(start)) continue;
    const end = addMinutes(start, duration);
    if (!reaches(start, end)) continue;
    out.push(make(start));
    if (out.length >= limit) break;
  }
  return out;
}

/** The order a day lists events in: all-day first, then by start, then by title. */
export function byStart(a: Occurrence, b: Occurrence): number {
  if (a.event.allDay !== b.event.allDay) return a.event.allDay ? -1 : 1;
  return a.start < b.start ? -1 : a.start > b.start ? 1 : a.event.title.localeCompare(b.event.title);
}

/** Every occurrence in the days [from, to) (to excluded) across `calendars`, in `byStart` order within each day's run. */
export function occurrencesIn(calendars: readonly Pick<Calendar, "id" | "events">[], from: Day, to: Day, skip: ReadonlySet<string> = new Set()): Occurrence[] {
  const out: Occurrence[] = [];
  for (const calendar of calendars) {
    if (skip.has(calendar.id)) continue;
    for (const event of calendar.events) out.push(...occurrencesOf(event, calendar.id, `${from}T00:00`, `${to}T00:00`));
  }
  return out.sort((a, b) => (dayPart(a.start) < dayPart(b.start) ? -1 : dayPart(a.start) > dayPart(b.start) ? 1 : byStart(a, b)));
}

/** The days in [from, to) that have at least one event. */
export function busyDays(calendars: readonly Pick<Calendar, "id" | "events">[], from: Day, to: Day, skip: ReadonlySet<string> = new Set()): Set<Day> {
  const busy = new Set<Day>();
  for (const occurrence of occurrencesIn(calendars, from, to, skip)) {
    const last = occurrence.end > occurrence.start ? addMinutes(occurrence.end, -1) : occurrence.start;
    for (let day = dayPart(occurrence.start); day <= dayPart(last) && day < to; day = addDays(day, 1)) if (day >= from) busy.add(day);
  }
  return busy;
}
