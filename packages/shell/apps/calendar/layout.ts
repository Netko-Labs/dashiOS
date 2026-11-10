/**
 * The arithmetic behind the three views: which days a month, a week, and a
 * day show, where the time grid puts an event (overlapping events share the
 * width), how many chips a month cell has room for, and how Today, previous,
 * and next move. Pure.
 */

import {
  addDays,
  addMonths,
  type Day,
  dayPart,
  daysInMonth,
  firstOfMonth,
  minuteOfDay,
  monthOf,
  startOfWeek,
  weekday,
} from "../../src/shared/calendar/dates.ts";
import type { Occurrence } from "../../src/shared/calendar/types.ts";

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
  /** Its left and right edges, as fractions of the column's width (0 to 1). */
  left: number;
  right: number;
}

/** Events that start this close (minutes) to one they overlap sit beside it; one starting later is drawn over it. */
export const SIDE_BY_SIDE = 30;
/** How far in a block drawn over another starts, as a fraction of the width it is drawn over. */
const CASCADE = 1 / 3;

/** Whether a timed occurrence happens on `day` (an all-day one is `coversDay`). */
export function touchesDay(occurrence: Occurrence, day: Day): boolean {
  const from = `${day}T00:00`;
  const to = `${addDays(day, 1)}T00:00`;
  return occurrence.end > occurrence.start ? occurrence.end > from && occurrence.start < to : occurrence.start >= from && occurrence.start < to;
}

/**
 * The timed occurrences that touch `day`, placed on its grid, in the order
 * to draw them. A column is split only where events really overlap: events
 * that start within `SIDE_BY_SIDE` minutes of each other share the width side
 * by side; one that starts later is drawn over the one it overlaps, a third
 * in, so the first keeps its whole width (and its title) outside the clash.
 */
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
  // Each run of side-by-side events: the span they share and its members, in order.
  const groups: Array<{ left: number; right: number; members: Placed[] }> = [];
  const groupOf = new Map<Placed, (typeof groups)[number]>();
  for (const item of items) {
    const over = placed.filter((other) => other.top < item.bottom && item.top < other.bottom);
    const near = over.filter((other) => item.top - other.top < SIDE_BY_SIDE);
    const beside = near.at(-1);
    const group = beside ? groupOf.get(beside) : undefined;
    const block: Placed = { ...item, left: 0, right: 1 };
    if (group) {
      group.members.push(block);
      const share = (group.right - group.left) / group.members.length;
      group.members.forEach((member, index) => {
        member.left = group.left + index * share;
        member.right = group.left + (index + 1) * share;
      });
      groupOf.set(block, group);
    } else {
      // Over the topmost block it overlaps (or the whole width when it overlaps none).
      const under = over.reduce<Placed | null>((top, other) => (top === null || other.left >= top.left ? other : top), null);
      const left = under === null ? 0 : under.left + (under.right - under.left) * CASCADE;
      const fresh = { left, right: under === null ? 1 : under.right, members: [block] };
      block.left = fresh.left;
      block.right = fresh.right;
      groups.push(fresh);
      groupOf.set(block, fresh);
    }
    placed.push(block);
  }
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
/** A month cell at least this wide shows a timed chip's start after its title; a narrower one gives the title all of it. */
export const CHIP_TIME_FROM = 92;
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
