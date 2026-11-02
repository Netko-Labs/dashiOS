/**
 * What the event sheet edits, apart from the screen: the fields as the person
 * sees them (a start day and minutes, the last day of an all-day event rather
 * than the day after it, a repeat chosen from a short list) and the steps
 * between those and a `CalEvent` or the `EventInput` the store takes. Pure.
 */

import { addDays, addMinutes, type Day, dayPart, daysBetween, minuteOfDay, minutesBetween } from "./dates.ts";
import type { EventInput } from "./event.ts";
import type { CalEvent, Frequency, Repeat } from "./types.ts";

export type RepeatChoice = "none" | Frequency | "custom";
export type EndsChoice = "never" | "count" | "until";

export interface Draft {
  title: string;
  calendarId: string;
  allDay: boolean;
  startDay: Day;
  /** Minutes after midnight; ignored for an all-day event. */
  startMinutes: number;
  /** For an all-day event, its last day (the file stores the day after). */
  endDay: Day;
  endMinutes: number;
  location: string;
  notes: string;
  repeat: RepeatChoice;
  every: number;
  ends: EndsChoice;
  count: number;
  until: Day;
  /** Weekly only: 0 Sunday … 6 Saturday. */
  weekdays: number[];
  alert: number | null;
}

/** A new event on `day`: all day when `minutes` is null, else an hour from there. */
export function blankDraft(calendarId: string, day: Day, minutes: number | null): Draft {
  const start = minutes ?? 9 * 60;
  return {
    title: "",
    calendarId,
    allDay: minutes === null,
    startDay: day,
    startMinutes: Math.min(start, 1439),
    endDay: day,
    endMinutes: Math.min(start + 60, 1439),
    location: "",
    notes: "",
    repeat: "none",
    every: 1,
    ends: "never",
    count: 10,
    until: addDays(day, 30),
    weekdays: [],
    alert: null,
  };
}

/** The draft of an existing event (the event's own first start, not one occurrence's). */
export function draftOf(event: CalEvent, calendarId: string): Draft {
  const startDay = dayPart(event.start);
  const lastDay = event.allDay ? addDays(dayPart(event.end), -1) : dayPart(event.end);
  const repeat: RepeatChoice = event.repeat ? event.repeat.freq : event.rawRule !== null ? "custom" : "none";
  const rule = event.repeat;
  return {
    title: event.title,
    calendarId,
    allDay: event.allDay,
    startDay,
    startMinutes: event.allDay ? 9 * 60 : minuteOfDay(event.start),
    endDay: lastDay < startDay ? startDay : lastDay,
    endMinutes: event.allDay ? 10 * 60 : minuteOfDay(event.end),
    location: event.location,
    notes: event.notes,
    repeat,
    every: rule?.interval ?? 1,
    ends: rule?.count !== undefined ? "count" : rule?.until !== undefined ? "until" : "never",
    count: rule?.count ?? 10,
    until: rule?.until ?? addDays(startDay, 30),
    weekdays: rule?.byDay ?? [],
    alert: event.alert,
  };
}

/** The wall-clock start and end a draft says; the end of an all-day event is the day after its last. */
export function timesOf(draft: Draft): { start: string; end: string } {
  if (draft.allDay) return { start: `${draft.startDay}T00:00`, end: `${addDays(draft.endDay < draft.startDay ? draft.startDay : draft.endDay, 1)}T00:00` };
  return { start: addMinutes(`${draft.startDay}T00:00`, draft.startMinutes), end: addMinutes(`${draft.endDay}T00:00`, draft.endMinutes) };
}

/** The repeat a draft chooses, or null (none), or undefined (a rule Calendar does not edit stays as it is). */
export function repeatOf(draft: Draft): Repeat | null | undefined {
  if (draft.repeat === "none") return null;
  if (draft.repeat === "custom") return undefined;
  const rule: Repeat = { freq: draft.repeat, interval: Math.max(1, Math.round(draft.every)) };
  if (draft.ends === "count") rule.count = Math.max(1, Math.round(draft.count));
  if (draft.ends === "until") rule.until = draft.until;
  if (draft.repeat === "weekly" && draft.weekdays.length > 0) rule.byDay = [...new Set(draft.weekdays)].sort((a, b) => a - b);
  return rule;
}

export function inputOf(draft: Draft): EventInput {
  const { start, end } = timesOf(draft);
  const repeat = repeatOf(draft);
  return {
    title: draft.title,
    allDay: draft.allDay,
    start,
    end,
    location: draft.location,
    notes: draft.notes,
    alert: draft.alert,
    ...(repeat === undefined ? {} : { repeat }),
  };
}

/** Why a draft cannot be saved, or null. */
export function problemWith(draft: Draft): string | null {
  const { start, end } = timesOf(draft);
  if (end < start) return "The event ends before it starts.";
  if (draft.repeat !== "none" && draft.repeat !== "custom" && draft.ends === "until" && draft.until < draft.startDay)
    return "The repeat ends before the event starts.";
  return null;
}

/** Moves the start, taking the end along so the event keeps its length. */
export function moveStart(draft: Draft, startDay: Day, startMinutes: number): Draft {
  if (draft.allDay) {
    const length = Math.max(0, daysBetween(draft.startDay, draft.endDay));
    return { ...draft, startDay, endDay: addDays(startDay, length) };
  }
  const before = addMinutes(`${draft.startDay}T00:00`, draft.startMinutes);
  const length = Math.max(0, minutesBetween(before, addMinutes(`${draft.endDay}T00:00`, draft.endMinutes)));
  const after = addMinutes(`${startDay}T00:00`, startMinutes);
  const end = addMinutes(after, length);
  return { ...draft, startDay, startMinutes, endDay: dayPart(end), endMinutes: minuteOfDay(end) };
}

/** Switches between all day and timed. A timed event keeps the times it had. */
export function setAllDay(draft: Draft, allDay: boolean): Draft {
  if (draft.allDay === allDay) return draft;
  return { ...draft, allDay, alert: draft.alert === null ? null : allDay ? -540 : 15 };
}
