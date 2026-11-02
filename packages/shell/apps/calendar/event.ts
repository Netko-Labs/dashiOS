/**
 * Checks an event somebody (the editing sheet, an agent, an import) wants to
 * save and makes the `CalEvent` that is written: trimmed, limited in size, with
 * times that are real and in order. A repeat or alert left out of an edit keeps
 * what the event had; what Calendar does not edit (other properties, alarms,
 * a repeat rule it cannot show) always stays.
 */

import { addDays, addMinutes, daysBetween, dayPart, isDay, isLocal, type Local, minuteOfDay } from "./dates.ts";
import { newUid, stampNow } from "./ics.ts";
import { type CalEvent, CalendarError, FREQUENCIES, type Repeat } from "./types.ts";

export const MAX_TITLE = 200;
export const MAX_LOCATION = 500;
export const MAX_NOTES = 20_000;
/** The longest an event may last (a year), so a typo does not fill the views. */
export const MAX_DURATION_MINUTES = 366 * 1440;
export const MAX_ALERT_MINUTES = 30 * 1440;

export interface EventInput {
  title?: string;
  allDay: boolean;
  start: Local;
  /** Exclusive for an all-day event. */
  end: Local;
  location?: string;
  notes?: string;
  /** null is no repeat; undefined keeps what the event has. */
  repeat?: Repeat | null;
  /** Minutes before the start; null is none; undefined keeps what the event has. */
  alert?: number | null;
}

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
  if (repeat.byDay !== undefined && repeat.byDay.length > 0) {
    if (repeat.freq !== "weekly") throw new CalendarError("Weekdays can only be chosen for a weekly repeat.");
    if (repeat.byDay.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) throw new CalendarError("Weekdays are numbered 0 (Sunday) to 6 (Saturday).");
    out.byDay = [...new Set(repeat.byDay)].sort((a, b) => a - b);
  }
  return out;
}

function clip(value: string | undefined, max: number, what: string): string {
  const text = (value ?? "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "");
  if (text.length > max) throw new CalendarError(`${what} can be at most ${max} characters.`);
  return text;
}

/** The event `input` describes; `existing` is the event being edited, whose uid and untouched parts it keeps. */
export function makeEvent(input: EventInput, existing?: CalEvent): CalEvent {
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

  const repeat = input.repeat === undefined ? (existing?.repeat ?? null) : input.repeat === null ? null : checkRepeat(input.repeat, start);
  const alert = input.alert === undefined ? (existing?.alert ?? null) : input.alert;
  if (alert !== null && (!Number.isInteger(alert) || alert < -MAX_ALERT_MINUTES || alert > MAX_ALERT_MINUTES))
    throw new CalendarError("An alert is a whole number of minutes, up to 30 days before.");

  // A deleted occurrence is named by its start, which an edit that moves the time makes meaningless.
  const sameClock = existing !== undefined && existing.allDay === input.allDay && existing.start.slice(10) === start.slice(10);
  const replacedRepeat = input.repeat !== undefined;
  return {
    uid: existing?.uid ?? newUid(),
    title,
    allDay: input.allDay,
    start,
    end,
    location: clip(input.location, MAX_LOCATION, "A location")
      .replace(/\s*\n\s*/g, " ")
      .trim(),
    notes: clip(input.notes, MAX_NOTES, "Notes"),
    repeat,
    rawRule: replacedRepeat ? null : (existing?.rawRule ?? null),
    exdates: sameClock && repeat ? (existing?.exdates ?? []) : [],
    alert,
    stamp: stampNow(),
    extra: existing?.extra ?? [],
    rawAlarms: existing?.rawAlarms ?? [],
  };
}

/** A new all-day or one-hour event on a day, for the sheet to start from. */
export function blankEvent(day: string, minutes: number | null): EventInput {
  if (minutes === null) return { allDay: true, start: `${day}T00:00`, end: `${addDays(day, 1)}T00:00`, alert: null };
  const start = addMinutes(`${day}T00:00`, minutes);
  return { allDay: false, start, end: addMinutes(start, 60), alert: null };
}
