/** What the store hands the app, the shell's reminders, and the agents. */

import type { Day, Local } from "./dates.ts";

export const FREQUENCIES = ["daily", "weekly", "monthly", "yearly"] as const;
export type Frequency = (typeof FREQUENCIES)[number];

/** "The 2nd Tuesday" (`n` 2, `day` 2) or "the last Friday" (`n` -1, `day` 5) of a month. */
export interface NthDay {
  /** 1 to 5 from the month's start, -1 to -5 from its end. */
  n: number;
  /** 0 Sunday … 6 Saturday. */
  day: number;
}

/**
 * A repeat Calendar can show and write: every N days, weeks, months, or
 * years. The sheet edits the simple ones (a weekly's weekdays, a monthly on
 * a date or on "the first Monday"); the rest (a yearly "4th Thursday of
 * November", a set position) come from other calendars, and are shown and
 * kept.
 */
export interface Repeat {
  freq: Frequency;
  /** 1 or more: every N periods. */
  interval: number;
  /** Stops after this many occurrences. */
  count?: number;
  /** Stops after this day (inclusive). Never with `count`. */
  until?: Day;
  /** The weekdays (0 Sunday … 6 Saturday), ascending: a weekly's days, or every such day of a monthly's or yearly's month (before `bySetPos`). */
  byDay?: number[];
  /** Monthly or yearly: the nth weekdays of the month (BYDAY=1MO,-1FR). */
  byNth?: NthDay[];
  /** Monthly or yearly: days of the month, 1 to 31, or -1 (the last) to -31. */
  byMonthDay?: number[];
  /** Yearly: the months, 1 to 12. */
  byMonth?: number[];
  /** Which of each period's days are kept, 1 the first, -1 the last (BYSETPOS). */
  bySetPos?: number[];
}

/** What one time of an event says: the event itself, or one changed occurrence of a repeat. */
export interface EventBody {
  title: string;
  allDay: boolean;
  /** Wall-clock start in `zone`. An all-day event starts at 00:00 of its first day. */
  start: Local;
  /** Wall-clock end in `zone`. An all-day event ends at 00:00 of the day after its last (as DTEND;VALUE=DATE does). */
  end: Local;
  /** The zone `start` and `end` are written in (an IANA name, or "UTC"); null is floating time, as every all-day event is (zones.ts). */
  zone: string | null;
  location: string;
  notes: string;
  /** Minutes before the start the alert fires (0 at the start; negative is after it); null for none. */
  alert: number | null;
  /** DTSTAMP as written, "20261105T120000Z". */
  stamp: string;
  /** Properties Calendar does not edit, kept as written (unfolded content lines). */
  extra: string[];
  /** Alarms Calendar does not edit, as written (unfolded content lines, BEGIN:VALARM … END:VALARM). */
  rawAlarms: string[];
}

/** One occurrence of a repeat changed on its own (a VEVENT with RECURRENCE-ID): moved, renamed, or cancelled. */
export interface Override extends EventBody {
  /** The start the occurrence has in the repeat, as a wall-clock time in the event's zone. */
  recurrenceId: Local;
}

export interface CalEvent extends EventBody {
  /** Stable across edits and across files; the id an agent or the shell refers to an event by. */
  uid: string;
  repeat: Repeat | null;
  /** A repeat outside what Calendar reads (RRULE text kept as written): the event shows once and the rule is written back unchanged. */
  rawRule: string | null;
  /** Occurrences that were deleted from a repeat (their starts, in the event's zone). */
  exdates: Local[];
  /** Occurrences changed on their own, by their start in the repeat. */
  overrides: Override[];
}

/** What one .ics file says. */
export interface IcsFile {
  name: string | null;
  /** "#RRGGBB" or null. */
  color: string | null;
  events: CalEvent[];
  /** Calendar-level properties Calendar does not edit, as written. */
  headerExtra: string[];
  /** VTIMEZONE components, as written (content lines), written back before the events. */
  timezones: string[];
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
  /** The event as this time shows it: the event, or a changed occurrence's title, place, and times laid over it (the same uid). */
  event: CalEvent;
  calendarId: string;
  /** On this computer's clock (zones.ts). */
  start: Local;
  /** Exclusive for an all-day event. On this computer's clock. */
  end: Local;
  /** A repeat's occurrence: the start it has in the repeat, in the event's zone (its RECURRENCE-ID). Null for an event that happens once. */
  recurrenceId: Local | null;
}

/** The store refused something. */
export class CalendarError extends Error {}
