/** What the store hands the app, the shell's reminders, and the agents. */

import type { Day, Local } from "./dates.ts";

export const FREQUENCIES = ["daily", "weekly", "monthly", "yearly"] as const;
export type Frequency = (typeof FREQUENCIES)[number];

/** A repeat Calendar can show, edit, and write: every N days, weeks, months, or years. */
export interface Repeat {
  freq: Frequency;
  /** 1 or more: every N periods. */
  interval: number;
  /** Stops after this many occurrences. */
  count?: number;
  /** Stops after this day (inclusive). Never with `count`. */
  until?: Day;
  /** Weekly only: the weekdays (0 Sunday … 6 Saturday), ascending. Empty or absent is the start's weekday. */
  byDay?: number[];
}

export interface CalEvent {
  /** Stable across edits and across files; the id an agent or the shell refers to an event by. */
  uid: string;
  title: string;
  allDay: boolean;
  /** Wall-clock start. An all-day event starts at 00:00 of its first day. */
  start: Local;
  /** Wall-clock end. An all-day event ends at 00:00 of the day after its last (as DTEND;VALUE=DATE does). */
  end: Local;
  location: string;
  notes: string;
  repeat: Repeat | null;
  /** A repeat outside what Calendar edits (RRULE text kept as written): the event shows once and the rule is written back unchanged. */
  rawRule: string | null;
  /** Occurrences that were deleted from a repeat (their start times). */
  exdates: Local[];
  /** Minutes before the start the alert fires (0 at the start; negative is after it); null for none. */
  alert: number | null;
  /** DTSTAMP as written, "20261105T120000Z". */
  stamp: string;
  /** Properties Calendar does not edit, kept as written (unfolded content lines). */
  extra: string[];
  /** Alarms Calendar does not edit, as written (unfolded content lines, BEGIN:VALARM … END:VALARM). */
  rawAlarms: string[];
}

/** What one .ics file says. */
export interface IcsFile {
  name: string | null;
  /** "#RRGGBB" or null. */
  color: string | null;
  events: CalEvent[];
  /** Calendar-level properties Calendar does not edit, as written. */
  headerExtra: string[];
  /** Components kept as written and not shown (to-dos, events it could not read), as content lines. */
  preserved: string[];
  /** Plain sentences about what could not be read. */
  problems: string[];
}

/** A calendar: one .ics file in the calendars folder. */
export interface Calendar extends IcsFile {
  /** The file name without ".ics". */
  id: string;
  name: string;
  color: string;
}

/** One time an event happens: a repeating event has many. */
export interface Occurrence {
  event: CalEvent;
  calendarId: string;
  start: Local;
  /** Exclusive for an all-day event. */
  end: Local;
}

/** The store refused something. */
export class CalendarError extends Error {}
