/**
 * Which calendar a new event goes to. Pure. An event never goes into a
 * hidden calendar, where it would vanish the moment it was saved: the
 * calendar chosen in the sidebar (or the one used last) if it shows, else
 * Home, else the first that shows. With every calendar hidden, the one it
 * would have been is named with `reveal`, and the window shows it again
 * before the event is made.
 */

import { DEFAULT_CALENDAR_NAME } from "../../src/shared/calendar/store.ts";

export interface Target {
  calendarId: string;
  /** The calendar is hidden and must be shown again first. */
  reveal: boolean;
}

/** Where a new event goes; null when there are no calendars at all. */
export function newEventTarget(calendars: ReadonlyArray<{ id: string; name: string }>, hidden: readonly string[], preferred: string | null): Target | null {
  const hiddenIds = new Set(hidden);
  const pick = (from: ReadonlyArray<{ id: string; name: string }>) =>
    from.find((calendar) => calendar.id === preferred) ?? from.find((calendar) => calendar.name === DEFAULT_CALENDAR_NAME) ?? from[0];
  const visible = pick(calendars.filter((calendar) => !hiddenIds.has(calendar.id)));
  if (visible) return { calendarId: visible.id, reveal: false };
  const fallback = pick(calendars);
  return fallback ? { calendarId: fallback.id, reveal: true } : null;
}

/** The calendars a new or edited event may be put in: the ones that show, and `current` (where it is now) even if not. */
export function choosableCalendars<T extends { id: string }>(calendars: readonly T[], hidden: readonly string[], current: string): T[] {
  const hiddenIds = new Set(hidden);
  return calendars.filter((calendar) => calendar.id === current || !hiddenIds.has(calendar.id));
}
