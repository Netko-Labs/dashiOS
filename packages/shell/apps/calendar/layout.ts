/**
 * The arithmetic behind the three views: which days a month, a week, and a
 * day show, where the time grid puts an event (overlapping events share the
 * width), how many chips a month cell has room for, and how Today, previous,
 * and next move. Pure.
 */

import { addDays, addMonths, type Day, dayPart, daysInMonth, firstOfMonth, minuteOfDay, monthOf, startOfWeek, weekday } from "./dates.ts";
import type { Occurrence } from "./types.ts";

export const VIEWS = ["day", "week", "month"] as const;
export type View = (typeof VIEWS)[number];

/** The weeks a month view shows: only the ones the month touches, each starting on `firstDay` (0 Sunday … 6 Saturday). */
export function monthGrid(anchor: Day, firstDay: number): Day[][] {
  const { year, month } = monthOf(anchor);
  const first = firstOfMonth(year, month);
  const start = startOfWeek(first, firstDay);
  const lead = (weekday(first) - firstDay + 7) % 7;
  const weeks = Math.ceil((lead + daysInMonth(year, month)) / 7);
  return Array.from({ length: weeks }, (_, week) => Array.from({ length: 7 }, (_, offset) => addDays(start, week * 7 + offset)));
}

/** The seven days of the week that holds `anchor`. */
export function weekDays(anchor: Day, firstDay: number): Day[] {
  const start = startOfWeek(anchor, firstDay);
  return Array.from({ length: 7 }, (_, offset) => addDays(start, offset));
}

/** The days a view shows around `anchor`. */
export function viewDays(view: View, anchor: Day, firstDay: number): Day[] {
  if (view === "day") return [anchor];
  if (view === "week") return weekDays(anchor, firstDay);
  return monthGrid(anchor, firstDay).flat();
}

/** The days to load events for: [from, to). */
export function viewRange(view: View, anchor: Day, firstDay: number): { from: Day; to: Day } {
  const days = viewDays(view, anchor, firstDay);
  return { from: days[0] as Day, to: addDays(days[days.length - 1] as Day, 1) };
}

/** Where previous and next (`direction` -1 or 1) take the view. */
export function step(view: View, anchor: Day, direction: -1 | 1): Day {
  if (view === "month") return addMonths(anchor, direction);
  return addDays(anchor, direction * (view === "week" ? 7 : 1));
}

// ---- The time grid --------------------------------------------------------------

export const HOUR_HEIGHT = 48;
export const GRID_HEIGHT = HOUR_HEIGHT * 24;
/** A short event still gets this many minutes of height, so it can be read and clicked. */
const MIN_VISUAL = 24;

export interface Placed {
  occurrence: Occurrence;
  /** Minutes after midnight the block starts and ends, clipped to the day. */
  top: number;
  bottom: number;
  /** Which of `columns` side-by-side columns it takes. */
  column: number;
  columns: number;
}

/** Whether a timed occurrence happens on `day` (an all-day one is `coversDay`). */
export function touchesDay(occurrence: Occurrence, day: Day): boolean {
  const from = `${day}T00:00`;
  const to = `${addDays(day, 1)}T00:00`;
  return occurrence.end > occurrence.start ? occurrence.end > from && occurrence.start < to : occurrence.start >= from && occurrence.start < to;
}

/** The timed occurrences that touch `day`, placed on its grid: overlapping ones sit side by side. */
export function placeDay(occurrences: readonly Occurrence[], day: Day): Placed[] {
  const items = occurrences
    .filter((occurrence) => !occurrence.event.allDay && touchesDay(occurrence, day))
    .map((occurrence) => {
      const top = dayPart(occurrence.start) < day ? 0 : minuteOfDay(occurrence.start);
      const bottom = dayPart(occurrence.end) > day ? 1440 : minuteOfDay(occurrence.end);
      return { occurrence, top, bottom: Math.max(bottom, Math.min(top + MIN_VISUAL, 1440)) };
    })
    .sort((a, b) => a.top - b.top || b.bottom - a.bottom);

  const placed: Placed[] = [];
  let cluster: Placed[] = [];
  let clusterEnd = -1;
  let ends: number[] = [];
  const close = (): void => {
    for (const item of cluster) item.columns = ends.length;
    placed.push(...cluster);
    cluster = [];
    ends = [];
  };
  for (const item of items) {
    if (cluster.length > 0 && item.top >= clusterEnd) close();
    let column = ends.findIndex((end) => end <= item.top);
    if (column < 0) column = ends.length;
    ends[column] = item.bottom;
    cluster.push({ ...item, column, columns: 1 });
    clusterEnd = Math.max(clusterEnd, item.bottom);
  }
  close();
  return placed;
}

/** The all-day occurrences that cover `day`. */
export function allDayOn(occurrences: readonly Occurrence[], day: Day): Occurrence[] {
  return occurrences.filter((occurrence) => occurrence.event.allDay && touchesDay(occurrence, day));
}

/** Every occurrence that touches `day`, in a day's order (all-day first). */
export function onDay(occurrences: readonly Occurrence[], day: Day): Occurrence[] {
  return occurrences.filter((occurrence) => touchesDay(occurrence, day));
}

/** Minutes after midnight at a y offset down the grid, snapped down to `snap` minutes. */
export function minutesAtY(y: number, snap = 30): number {
  const minutes = Math.floor(((y / HOUR_HEIGHT) * 60) / snap) * snap;
  return Math.max(0, Math.min(1440 - snap, minutes));
}

/**
 * The hour at the top of the grid when a Day or Week view opens: the working day from 7 AM, unless it is today and the time
 * now would be out of sight, then enough of the day around now that the red line shows.
 */
export function firstHour(showsToday: boolean, nowHour: number): number {
  if (!showsToday) return 7;
  if (nowHour < 8) return Math.max(0, nowHour - 1);
  return nowHour > 17 ? Math.min(nowHour - 10, 14) : 7;
}

export const yAtMinutes = (minutes: number): number => (minutes / 60) * HOUR_HEIGHT;

/** Where the hours scroll to show a new event starting at `minutes`: an hour of the day above it in sight. */
export const revealOffset = (minutes: number): number => Math.max(0, yAtMinutes(minutes) - HOUR_HEIGHT);

// ---- The month grid -----------------------------------------------------------------

export const MONTH_CHIP_HEIGHT = 17;
/** The day number's row and the cell's padding. */
const MONTH_CELL_HEAD = 28;

/** How many event chips fit in a month cell `cellHeight` tall (one slot is kept for "N more" when some are left out). */
export function chipCapacity(cellHeight: number): number {
  return Math.max(0, Math.floor((cellHeight - MONTH_CELL_HEAD) / MONTH_CHIP_HEIGHT));
}

/** The chips to draw and how many are left out. */
export function fitChips<T>(items: readonly T[], capacity: number): { shown: T[]; more: number } {
  if (items.length <= capacity) return { shown: [...items], more: 0 };
  const room = Math.max(0, capacity - 1);
  return { shown: items.slice(0, room), more: items.length - room };
}
