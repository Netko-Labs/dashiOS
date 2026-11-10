/**
 * What the calendar model holds, and the names the window uses for it.
 */

import type { Day, Local } from "../../src/shared/calendar/dates.ts";
import type { Calendar } from "../../src/shared/calendar/types.ts";
import type { View } from "./layout.ts";

export interface CalendarState {
  calendars: Calendar[];
  /** Files that could not be read, and events kept but not shown. */
  problems: string[];
  /** Calendar ids the person has turned off. */
  hidden: string[];
  view: View;
  /** The day the view is on (any day of the month or week shown). */
  anchor: Day;
  /** The day picked (a click, the arrows): where New Event and Return make one. Always one the view shows. */
  selected: Day;
  today: Day;
  /** The last thing that went wrong, for a line in the window. */
  error: string | null;
  /** The last thing that went well and is worth saying (an import). */
  notice: string | null;
}

/** One time of an event, as the window names it to the model. */
export interface OccurrenceRef {
  calendarId: string;
  uid: string;
  /** Null for an event that happens once. */
  recurrenceId: Local | null;
}

/** How long a notice that only informs stays (Files' `NOTICE_FADE_MS`). */
export const NOTICE_FADE_MS = 5000;
