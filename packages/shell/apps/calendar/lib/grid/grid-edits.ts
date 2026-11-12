/**
 * What the grid's gestures and quick add come to as changes the model takes:
 * a dropped event's new times on its own clock, a named new event's input,
 * and whether a change asks which times of a repeat it is for. Pure.
 */

import {
  addDays,
  addMinutes,
  at,
  type Day,
  dayPart,
  type EventInput,
  fromHere,
  minutesBetween,
  type Occurrence,
} from "../../../../src/shared/calendar/index.ts";
import { parseQuickAdd } from "../quickadd.ts";
import type { OccurrenceRef } from "../state.ts";
import type { Preview } from "./drag.ts";
import type { Pending } from "./inline-title.tsx";

export const refOf = (occurrence: Occurrence): OccurrenceRef => ({
  calendarId: occurrence.calendarId,
  uid: occurrence.event.uid,
  recurrenceId: occurrence.recurrenceId,
});

/** A change to this time asks "this event, this and following, or all" (a repeat Calendar reads; a rule it can't is changed one time at a time). */
export const asksScope = (occurrence: Occurrence): boolean => occurrence.recurrenceId !== null && occurrence.event.repeat !== null;

/** The occurrence's start and end on the event's own clock. */
export function zonedTimes(occurrence: Occurrence, here?: string): { start: string; end: string } {
  const zone = occurrence.event.allDay ? null : occurrence.event.zone;
  return { start: fromHere(occurrence.start, zone, here), end: fromHere(occurrence.end, zone, here) };
}

/** The event as it is, at the times a drag left it (on this computer's clock), for the model. */
export function movedInput(occurrence: Occurrence, preview: Preview, here?: string): EventInput {
  const { event } = occurrence;
  const zone = event.allDay ? null : event.zone;
  return {
    title: event.title,
    allDay: event.allDay,
    start: fromHere(preview.start, zone, here),
    end: fromHere(preview.end, zone, here),
    zone,
    location: event.location,
    notes: event.notes,
  };
}

/** "Move Event" or "Resize Event", by whether the start moved. */
export const dropName = (occurrence: Pick<Occurrence, "start">, preview: Preview): string =>
  occurrence.start === preview.start ? "Resize Event" : "Move Event";

/** A new event being named: on `day`, all day when `minutes` is null, else an hour from there. */
export function pendingAt(calendarId: string, day: Day, minutes: number | null): Pending {
  if (minutes === null) return { calendarId, start: `${day}T00:00`, end: `${addDays(day, 1)}T00:00`, allDay: true, title: "" };
  const start = at(day, Math.min(minutes, 1440 - 60));
  return { calendarId, start, end: addMinutes(start, 60), allDay: false, title: "" };
}

/** The event a named one makes, with what quick add reads in its title (`hour12`: a bare "3" is 3 PM). */
export function pendingInput(pending: Pending, today: Day, hour12: boolean): EventInput {
  const said = parseQuickAdd(pending.title, today, hour12);
  const day = said.day ?? dayPart(pending.start);
  const length = Math.max(15, minutesBetween(pending.start, pending.end));
  let allDay = pending.allDay;
  let start = `${day}T${pending.start.slice(11)}`;
  let end = addMinutes(start, pending.allDay ? 1440 : length);
  if (said.start !== undefined) {
    allDay = false;
    start = at(day, said.start);
    end = said.end !== undefined ? at(day, said.end) : addMinutes(start, pending.allDay ? 60 : length);
  } else if (said.allDay) {
    allDay = true;
    start = `${day}T00:00`;
    end = `${addDays(day, 1)}T00:00`;
  } else if (pending.allDay) {
    // Moved to another day, an all-day event keeps its days.
    end = addMinutes(start, minutesBetween(pending.start, pending.end));
  }
  return { title: said.title, allDay, start, end, alert: null, ...(said.repeat ? { repeat: said.repeat } : {}) };
}

/** The half hour a minute on the grid is in. */
export const halfHour = (minutes: number): number => Math.max(0, Math.min(1410, Math.floor(minutes / 30) * 30));

/** Where a new event goes when it is asked for from the menu or N: the slot picked, else the next whole hour today, else 9:00. */
export function newEventMinutes(day: Day, slot: number | null, today: Day, now: Date): number {
  if (slot !== null) return slot;
  if (day !== today) return 9 * 60;
  return Math.min(23 * 60, (Math.floor((now.getHours() * 60 + now.getMinutes()) / 60) + 1) * 60);
}
