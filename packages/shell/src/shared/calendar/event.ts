/**
 * Checks an event somebody (the editing sheet, a drag on the grid, an agent,
 * an import) wants to save and makes the `CalEvent` that is written: trimmed,
 * limited in size, with times that are real and in order, in a zone this
 * computer knows. A repeat, alert, or zone left out of an edit keeps what the
 * event had; what Calendar does not edit (other properties, alarms, a repeat
 * rule it cannot show) always stays.
 */

import { addDays, addMinutes, dayPart, daysBetween, isDay, isLocal, type Local, minuteOfDay } from "./dates.ts";
import { newUid } from "./ics.ts";
import { stampNow } from "./lib/ics-time.ts";
import { type CalEvent, CalendarError, type EventBody, FREQUENCIES, type Override, type Repeat } from "./types.ts";
import { hereZone, isZone } from "./zones.ts";

export const MAX_TITLE = 200;
export const MAX_LOCATION = 500;
export const MAX_NOTES = 20_000;
/** The longest an event may last (a year), so a typo does not fill the views. */
export const MAX_DURATION_MINUTES = 366 * 1440;
export const MAX_ALERT_MINUTES = 30 * 1440;

export interface EventInput {
  title?: string;
  allDay: boolean;
  /** Wall-clock times in `zone`. */
  start: Local;
  /** Exclusive for an all-day event. */
  end: Local;
  /** The zone the times are in; null is floating; undefined keeps the event's (this computer's for a new timed event). */
  zone?: string | null;
  location?: string;
  notes?: string;
  /** null is no repeat; undefined keeps what the event has. */
  repeat?: Repeat | null;
  /** Minutes before the start; null is none; undefined keeps what the event has. */
  alert?: number | null;
}

const isWeekday = (day: unknown): boolean => typeof day === "number" && Number.isInteger(day) && day >= 0 && day <= 6;

/** The repeat as it is kept, or a CalendarError saying what is wrong. */
export function checkRepeat(repeat: Repeat, start: Local): Repeat {
  if (!(FREQUENCIES as readonly string[]).includes(repeat.freq)) throw new CalendarError("The repeat must be daily, weekly, monthly, or yearly.");
  if (!Number.isInteger(repeat.interval) || repeat.interval < 1 || repeat.interval > 999)
    throw new CalendarError("The repeat interval must be a whole number from 1 to 999.");
  const out: Repeat = { freq: repeat.freq, interval: repeat.interval };
  if (repeat.count !== undefined && repeat.until !== undefined) throw new CalendarError("A repeat ends after a number of times or on a day, not both.");
  if (repeat.count !== undefined) {
    if (!Number.isInteger(repeat.count) || repeat.count < 1 || repeat.count > 9999)
      throw new CalendarError("The repeat count must be a whole number from 1 to 9999.");
    out.count = repeat.count;
  }
  if (repeat.until !== undefined) {
    if (!isDay(repeat.until)) throw new CalendarError("The day a repeat ends must be a date like 2026-11-05.");
    if (repeat.until < dayPart(start)) throw new CalendarError("A repeat cannot end before the event starts.");
    out.until = repeat.until;
  }
  const monthly = repeat.freq === "monthly" || repeat.freq === "yearly";
  if (repeat.byDay !== undefined && repeat.byDay.length > 0) {
    if (repeat.freq === "daily") throw new CalendarError("Weekdays can't be chosen for a daily repeat.");
    if (!repeat.byDay.every(isWeekday)) throw new CalendarError("Weekdays are numbered 0 (Sunday) to 6 (Saturday).");
    out.byDay = [...new Set(repeat.byDay)].sort((a, b) => a - b);
  }
  if (repeat.byNth !== undefined && repeat.byNth.length > 0) {
    if (!monthly) throw new CalendarError("“The first Monday” is for a monthly or yearly repeat.");
    if (!repeat.byNth.every(({ n, day }) => Number.isInteger(n) && n !== 0 && Math.abs(n) <= 5 && isWeekday(day)))
      throw new CalendarError("A weekday of the month is the 1st to 5th, or the last.");
    out.byNth = repeat.byNth.map(({ n, day }) => ({ n, day }));
  }
  if (repeat.byMonthDay !== undefined && repeat.byMonthDay.length > 0) {
    if (!monthly || !repeat.byMonthDay.every((day) => Number.isInteger(day) && day !== 0 && Math.abs(day) <= 31))
      throw new CalendarError("Days of the month are 1 to 31, for a monthly or yearly repeat.");
    out.byMonthDay = [...new Set(repeat.byMonthDay)].sort((a, b) => a - b);
  }
  if (repeat.byMonth !== undefined && repeat.byMonth.length > 0) {
    if (repeat.freq !== "yearly" || !repeat.byMonth.every((month) => Number.isInteger(month) && month >= 1 && month <= 12))
      throw new CalendarError("Months are 1 to 12, for a yearly repeat.");
    out.byMonth = [...new Set(repeat.byMonth)].sort((a, b) => a - b);
  }
  if (repeat.freq === "yearly" && out.byMonth === undefined && (out.byDay || out.byNth || out.byMonthDay))
    throw new CalendarError("A yearly repeat on weekdays or days of the month names its months.");
  if (repeat.bySetPos !== undefined && repeat.bySetPos.length > 0) {
    if (!monthly || !repeat.bySetPos.every((position) => Number.isInteger(position) && position !== 0 && Math.abs(position) <= 366))
      throw new CalendarError("A set position is for a monthly or yearly repeat.");
    out.bySetPos = [...new Set(repeat.bySetPos)].sort((a, b) => a - b);
  }
  return out;
}

function clip(value: string | undefined, max: number, what: string): string {
  const text = (value ?? "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "");
  if (text.length > max) throw new CalendarError(`${what} can be at most ${max} characters.`);
  return text;
}

/** The zone an edit's times are in: the one given (checked), else the event's, else this computer's. */
function zoneFor(input: EventInput, existing: EventBody | undefined): string | null {
  if (input.allDay) return null;
  if (input.zone === undefined) return existing && !existing.allDay ? existing.zone : hereZone();
  if (input.zone === null || isZone(input.zone) || input.zone === existing?.zone) return input.zone;
  throw new CalendarError(`“${String(input.zone).slice(0, 40)}” is not a time zone this computer knows.`);
}

/** What any time of an event says, checked: title, times, zone, place, notes, alert. */
export function makeBody(input: EventInput, existing?: EventBody): EventBody {
  const title =
    clip(input.title, MAX_TITLE, "A title")
      .replace(/\s*\n\s*/g, " ")
      .trim() || "New Event";
  if (!isLocal(input.start) || !isLocal(input.end)) throw new CalendarError("An event needs a start and an end time like 2026-11-05T14:00.");
  let { start, end } = input;
  if (input.allDay) {
    start = `${dayPart(start)}T00:00`;
    end = `${dayPart(end)}T00:00`;
    if (end <= start) end = `${addDays(dayPart(start), 1)}T00:00`;
  } else if (end < start) {
    throw new CalendarError("An event cannot end before it starts.");
  }
  const minutes = daysBetween(dayPart(start), dayPart(end)) * 1440 + minuteOfDay(end) - minuteOfDay(start);
  if (minutes > MAX_DURATION_MINUTES) throw new CalendarError("An event can last at most a year.");
  const alert = input.alert === undefined ? (existing?.alert ?? null) : input.alert;
  if (alert !== null && (!Number.isInteger(alert) || alert < -MAX_ALERT_MINUTES || alert > MAX_ALERT_MINUTES))
    throw new CalendarError("An alert is a whole number of minutes, up to 30 days before.");
  return {
    title,
    allDay: input.allDay,
    start,
    end,
    zone: zoneFor(input, existing),
    location: clip(input.location, MAX_LOCATION, "A location")
      .replace(/\s*\n\s*/g, " ")
      .trim(),
    notes: clip(input.notes, MAX_NOTES, "Notes"),
    alert,
    stamp: stampNow(),
    extra: existing?.extra ?? [],
    rawAlarms: existing?.rawAlarms ?? [],
  };
}

/** The event `input` describes; `existing` is the event being edited, whose uid and untouched parts it keeps. */
export function makeEvent(input: EventInput, existing?: CalEvent): CalEvent {
  const body = makeBody(input, existing);
  const repeat = input.repeat === undefined ? (existing?.repeat ?? null) : input.repeat === null ? null : checkRepeat(input.repeat, body.start);
  // Deleted and changed occurrences are named by their start, which an edit that moves the time makes meaningless (edits.ts moves them along).
  const sameClock =
    existing !== undefined && existing.allDay === body.allDay && existing.start.slice(10) === body.start.slice(10) && existing.zone === body.zone;
  const rawRule = input.repeat !== undefined ? null : (existing?.rawRule ?? null);
  const keeps = sameClock && (repeat !== null || rawRule !== null);
  return {
    ...body,
    uid: existing?.uid ?? newUid(),
    repeat,
    rawRule,
    exdates: keeps ? (existing?.exdates ?? []) : [],
    overrides: keeps ? (existing?.overrides ?? []) : [],
  };
}

/** One occurrence of a repeat, changed on its own. */
export function makeOverride(input: EventInput, recurrenceId: Local, existing?: EventBody): Override {
  return { ...makeBody(input, existing), recurrenceId };
}

/** A new all-day or one-hour event on a day, for the sheet to start from. */
export function blankEvent(day: string, minutes: number | null): EventInput {
  if (minutes === null) return { allDay: true, start: `${day}T00:00`, end: `${addDays(day, 1)}T00:00`, alert: null };
  const start = addMinutes(`${day}T00:00`, minutes);
  return { allDay: false, start, end: addMinutes(start, 60), alert: null };
}
