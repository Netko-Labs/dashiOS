/**
 * When events happen: a repeating event expanded over a range of this
 * computer's wall-clock time. Daily, weekly (with weekdays), monthly and
 * yearly (the start's day of the month, or the days and nth weekdays a rule
 * names, a set position among them; months without the day are skipped, as
 * RFC 5545 has it), every N periods, stopping after COUNT occurrences or on
 * UNTIL. Deleted occurrences (EXDATE) are left out, and changed ones
 * (RECURRENCE-ID) show as they were changed, cancelled ones not at all.
 *
 * A repeat is expanded on its own zone's clock, so a daily 9:00 in New York
 * stays at 9:00 there across both zones' clock changes; each occurrence is
 * then shown on this computer's clock (zones.ts).
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
import { isCancelled } from "./lib/ics-read.ts";
import type { CalEvent, Calendar, Occurrence, Override, Repeat } from "./types.ts";
import { fromHere, hereZone, toHere } from "./zones.ts";

/** The most occurrences one expansion yields; a rule that goes on past this is cut. */
export const MAX_OCCURRENCES = 5_000;
/** The most candidate periods stepped through for one event (a COUNT of thousands starts at the beginning). */
const MAX_STEPS = 50_000;

const pad = (n: number): string => String(n).padStart(2, "0");

/** The days of one month a monthly or yearly repeat lands on, ascending. `dom` is the start's day of the month. */
export function monthDays(year: number, month: number, repeat: Repeat, dom: number): number[] {
  const last = daysInMonth(year, month);
  let days: number[] | null = repeat.byMonthDay?.map((day) => (day > 0 ? day : last + 1 + day)).filter((day) => day >= 1 && day <= last) ?? null;
  const first = weekday(firstOfMonth(year, month));
  const onWeekdays: number[] = [];
  const plain = repeat.freq === "weekly" ? [] : (repeat.byDay ?? []);
  for (let day = 1; day <= last && plain.length > 0; day++) if (plain.includes((first + day - 1) % 7)) onWeekdays.push(day);
  for (const { n, day } of repeat.byNth ?? []) {
    const firstHit = 1 + ((day - first + 7) % 7);
    const hits = Math.floor((last - firstHit) / 7) + 1;
    const index = n > 0 ? n - 1 : hits + n;
    if (index >= 0 && index < hits) onWeekdays.push(firstHit + 7 * index);
  }
  if (plain.length > 0 || (repeat.byNth?.length ?? 0) > 0) days = days ? days.filter((day) => onWeekdays.includes(day)) : onWeekdays;
  days ??= dom <= last ? [dom] : [];
  return [...new Set(days)].sort((a, b) => a - b);
}

/** BYSETPOS: the period's days kept by position (1 the first, -1 the last). */
function atPositions<T>(list: readonly T[], positions: readonly number[] | undefined): T[] {
  if (!positions || positions.length === 0) return [...list];
  const kept = new Set<number>();
  for (const position of positions) {
    const index = position > 0 ? position - 1 : list.length + position;
    if (index >= 0 && index < list.length) kept.add(index);
  }
  return [...kept].sort((a, b) => a - b).map((index) => list[index] as T);
}

/** The starts of a repeat, ascending, beginning with the period `first`. */
function* starts(startsAt: Local, repeat: Repeat, first: number): Generator<Local> {
  const startDay = dayPart(startsAt);
  const time = startsAt.slice(10);
  const { interval } = repeat;
  const begin = monthOf(startDay);
  const dom = Number(startDay.slice(8, 10));
  const weekBase = startOfWeek(startDay, 1);
  const weekdays = (repeat.byDay && repeat.byDay.length > 0 ? repeat.byDay : [weekday(startDay)]).map((index) => (index + 6) % 7).sort((a, b) => a - b);
  const dayOf = (year: number, month: number, day: number): Day => `${String(year).padStart(4, "0")}-${pad(month + 1)}-${pad(day)}`;
  for (let i = first; i < first + MAX_STEPS; i++) {
    let days: Day[] = [];
    switch (repeat.freq) {
      case "daily":
        days = [addDays(startDay, i * interval)];
        break;
      case "weekly": {
        const week = addDays(weekBase, 7 * interval * i);
        days = weekdays.map((offset) => addDays(week, offset));
        break;
      }
      case "monthly": {
        const index = begin.year * 12 + begin.month + i * interval;
        const year = Math.floor(index / 12);
        const month = index % 12;
        days = atPositions(monthDays(year, month, repeat, dom), repeat.bySetPos).map((day) => dayOf(year, month, day));
        break;
      }
      case "yearly": {
        const year = begin.year + i * interval;
        const months = repeat.byMonth && repeat.byMonth.length > 0 ? repeat.byMonth.map((month) => month - 1) : [begin.month];
        const all = months.flatMap((month) => monthDays(year, month, repeat, dom).map((day) => dayOf(year, month, day)));
        days = atPositions(all, repeat.bySetPos);
        break;
      }
    }
    if (days.length > 0 && Number(days[0]?.slice(0, 4)) > 9999) return;
    for (const day of days) if (day >= startDay) yield `${day}${time}`;
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

/**
 * The starts a repeat makes (in its own zone), from its first up to `before`
 * (excluded), deleted ones included: what COUNT counts.
 */
export function countBefore(event: Pick<CalEvent, "start" | "repeat">, before: Local): number {
  if (!event.repeat) return event.start < before ? 1 : 0;
  let produced = 0;
  for (const start of starts(event.start, event.repeat, 0)) {
    if (start >= before || (event.repeat.until !== undefined && dayPart(start) > event.repeat.until)) break;
    produced++;
    if (event.repeat.count !== undefined && produced >= event.repeat.count) break;
  }
  return produced;
}

/** Whether `at` (in the event's zone) is one of the repeat's starts. */
export function isStartOf(event: Pick<CalEvent, "start" | "repeat">, at: Local): boolean {
  if (!event.repeat) return at === event.start;
  const first = event.repeat.count === undefined ? firstPeriod(event.start, event.repeat, addDays(dayPart(at), -1)) : 0;
  let produced = 0;
  for (const start of starts(event.start, event.repeat, first)) {
    if (start > at || (event.repeat.until !== undefined && dayPart(start) > event.repeat.until)) return false;
    produced++;
    if (event.repeat.count !== undefined && produced > event.repeat.count) return false;
    if (start === at) return true;
  }
  return false;
}

/** The event as one changed occurrence shows it. */
const laidOver = (event: CalEvent, override: Override): CalEvent => {
  const { recurrenceId: _id, ...body } = override;
  return { ...event, ...body };
};

/** Every time `event` happens that overlaps [from, to) on this computer's clock (`here`). */
export function occurrencesOf(event: CalEvent, calendarId: string, from: Local, to: Local, limit = MAX_OCCURRENCES, here: string = hereZone()): Occurrence[] {
  const zone = event.allDay ? null : event.zone;
  const duration = minutesBetween(event.start, event.end);
  const reaches = (start: Local, end: Local): boolean => (end > start ? end > from && start < to : start >= from && start < to);
  const out: Occurrence[] = [];
  const changed = new Map(event.overrides.map((override) => [override.recurrenceId, override]));
  const repeat = event.repeat;

  if (!repeat) {
    const start = toHere(event.start, zone, here);
    const end = toHere(event.end, zone, here);
    if (!changed.has(event.start) && reaches(start, end)) out.push({ event, calendarId, start, end, recurrenceId: null });
  } else {
    const skipped = new Set(event.exdates);
    const spanDays = Math.ceil(duration / 1440) + 1;
    // The range on the repeat's own clock; a day either side covers any zone's offset.
    const zonedFrom = addDays(dayPart(fromHere(from, zone, here)), -1);
    const zonedTo = `${addDays(dayPart(fromHere(to, zone, here)), 1)}T00:00`;
    // A COUNT is counted from the first occurrence, so it cannot jump ahead.
    const first = repeat.count === undefined ? firstPeriod(event.start, repeat, addDays(zonedFrom, -spanDays)) : 0;
    let produced = 0;
    for (const zoned of starts(event.start, repeat, first)) {
      if (zoned >= zonedTo || (repeat.until !== undefined && dayPart(zoned) > repeat.until)) break;
      produced++;
      if (repeat.count !== undefined && produced > repeat.count) break;
      if (skipped.has(zoned) || changed.has(zoned)) continue;
      const start = toHere(zoned, zone, here);
      const end = toHere(addMinutes(zoned, duration), zone, here);
      if (!reaches(start, end)) continue;
      out.push({ event, calendarId, start, end, recurrenceId: zoned });
      if (out.length >= limit) break;
    }
  }
  for (const override of event.overrides) {
    if (isCancelled(override) || event.exdates.includes(override.recurrenceId) || out.length >= limit) continue;
    const ownZone = override.allDay ? null : override.zone;
    const start = toHere(override.start, ownZone, here);
    const end = toHere(override.end, ownZone, here);
    if (reaches(start, end)) out.push({ event: laidOver(event, override), calendarId, start, end, recurrenceId: override.recurrenceId });
  }
  return event.overrides.length > 0 ? out.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0)) : out;
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
