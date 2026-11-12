/**
 * The grid as the editor (design.html PA-11): what a press, a move and a
 * release on Calendar's views come to. Drawing on empty time makes an event,
 * dragging a block moves it (across days in a week), dragging its bottom edge
 * resizes it, and dragging a chip in the month or the all-day strip moves it
 * to another day. Times snap to 15 minutes. A pointer that moves less than
 * `DRAG_SLOP` is a click. Pure: the views feed it window pixels, and the
 * window decides what the result does (Esc cancels it before the release).
 */

import { addDays, addMinutes, at, type Day, dayPart, type Local, minuteOfDay, minutesBetween, type Occurrence } from "../../../../src/shared/calendar/index.ts";
import { HOUR_HEIGHT } from "../layout.ts";

export const SNAP_MINUTES = 15;
/** Pixels the pointer may move and still click. */
export const DRAG_SLOP = 4;
/** The shortest event a drag makes or leaves. */
export const MIN_MINUTES = SNAP_MINUTES;

export type DragKind = "create" | "move" | "resize" | "move-days";

export interface DragStart {
  kind: DragKind;
  /** Where the pointer went down, in window pixels. */
  x: number;
  y: number;
  /** The day (column or cell) it went down on. */
  day: Day;
  /** create: minutes after midnight the pointer was at. */
  minutes?: number;
  /** move, resize, move-days: what is dragged. */
  occurrence?: Occurrence;
}

/** Where the views are, for turning pixels into days. */
export interface Geometry {
  /** The days the time grid's columns show, in order. */
  days: readonly Day[];
  /** One column's width (the time grid, the all-day strip). */
  columnWidth: number;
  /** The month's day under a point in window pixels; null outside it. */
  dayAt?: (x: number, y: number) => Day | null;
}

/** What the drag would do if let go now: a new or moved event's times on this computer's clock. */
export interface Preview {
  start: Local;
  end: Local;
  allDay: boolean;
}

/** Whether the pointer has moved far enough to be a drag. */
export const isDrag = (dx: number, dy: number): boolean => Math.hypot(dx, dy) >= DRAG_SLOP;

/** Minutes for a distance down the grid. */
export const minutesFor = (dy: number): number => (dy / HOUR_HEIGHT) * 60;

const snap = (minutes: number): number => Math.round(minutes / SNAP_MINUTES) * SNAP_MINUTES;
const snapDown = (minutes: number): number => Math.floor(minutes / SNAP_MINUTES) * SNAP_MINUTES;
const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));

/** How many columns over the pointer is, kept inside the days shown. */
function columnsOver(start: DragStart, dx: number, geometry: Geometry): number {
  const from = geometry.days.indexOf(start.day);
  if (from < 0 || geometry.columnWidth <= 0) return 0;
  return clamp(Math.round(dx / geometry.columnWidth), -from, geometry.days.length - 1 - from);
}

/** The times the drag gives, the pointer now `dx`, `dy` from where it went down (at `x`, `y` in the window). */
export function previewOf(start: DragStart, dx: number, dy: number, geometry: Geometry, x = start.x + dx, y = start.y + dy): Preview | null {
  const occurrence = start.occurrence;
  switch (start.kind) {
    case "create": {
      const from = snapDown(clamp(start.minutes ?? 0, 0, 1440 - MIN_MINUTES));
      const to = snapDown(clamp((start.minutes ?? 0) + minutesFor(dy), 0, 1440 - MIN_MINUTES));
      return { start: at(start.day, Math.min(from, to)), end: at(start.day, Math.max(from, to) + MIN_MINUTES), allDay: false };
    }
    case "move": {
      if (!occurrence) return null;
      const day = addDays(dayPart(occurrence.start), columnsOver(start, dx, geometry));
      const minutes = clamp(snap(minuteOfDay(occurrence.start) + minutesFor(dy)), 0, 1440 - MIN_MINUTES);
      const begins = at(day, minutes);
      return { start: begins, end: addMinutes(begins, minutesBetween(occurrence.start, occurrence.end)), allDay: false };
    }
    case "resize": {
      if (!occurrence) return null;
      // The edge dragged is the one in the column it was pressed in.
      const endsAt = minutesBetween(`${start.day}T00:00`, occurrence.end);
      const end = at(start.day, clamp(snap(endsAt + minutesFor(dy)), 0, 1440));
      const shortest = addMinutes(occurrence.start, MIN_MINUTES);
      return { start: occurrence.start, end: end < shortest ? shortest : end, allDay: false };
    }
    case "move-days": {
      if (!occurrence) return null;
      const target = geometry.dayAt ? geometry.dayAt(x, y) : addDays(start.day, columnsOver(start, dx, geometry));
      if (target === null) return null;
      const days = Math.round(minutesBetween(`${start.day}T00:00`, `${target}T00:00`) / 1440);
      return { start: addMinutes(occurrence.start, days * 1440), end: addMinutes(occurrence.end, days * 1440), allDay: occurrence.event.allDay };
    }
  }
}

/** Whether a preview is where the occurrence already is (a drag that came back). */
export const isSameTimes = (occurrence: Pick<Occurrence, "start" | "end">, preview: Preview): boolean =>
  occurrence.start === preview.start && occurrence.end === preview.end;

/** The month's day at a point: the grid's bounds in window pixels, cut into `weeks` rows of seven. */
export function monthDayAt(
  grid: { x: number; y: number; width: number; height: number },
  weeks: readonly (readonly Day[])[],
  x: number,
  y: number,
): Day | null {
  if (grid.width <= 0 || grid.height <= 0 || weeks.length === 0) return null;
  const column = Math.floor(((x - grid.x) / grid.width) * 7);
  const row = Math.floor(((y - grid.y) / grid.height) * weeks.length);
  return weeks[clamp(row, 0, weeks.length - 1)]?.[clamp(column, 0, 6)] ?? null;
}
