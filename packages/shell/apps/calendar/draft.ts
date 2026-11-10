/**
 * What the event sheet edits, apart from the screen: the fields as the person
 * sees them (a start day and minutes on the event's own clock, its zone, the
 * last day of an all-day event rather than the day after it, a repeat chosen
 * from a short list) and the steps between those and a `CalEvent` or the
 * `EventInput` the store takes. The sheet opens on the time that was clicked,
 * not the repeat's first. Pure.
 */

import { addDays, addMinutes, type Day, dayPart, daysBetween, minuteOfDay, minutesBetween, weekday } from "../../src/shared/calendar/dates.ts";
import type { EventInput } from "../../src/shared/calendar/event.ts";
import { isSimpleRepeat } from "../../src/shared/calendar/rules.ts";
import type { CalEvent, Frequency, NthDay, Repeat } from "../../src/shared/calendar/types.ts";
import { hereZone } from "../../src/shared/calendar/zones.ts";

export type RepeatChoice = "none" | Frequency | "custom";
export type EndsChoice = "never" | "count" | "until";
/** A monthly repeat: on the start's date ("on day 12"), or on its weekday of the month ("on the second Thursday"). */
export type MonthlyBy = "date" | "weekday";

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
  /** The zone the times are on (a timed event); null is floating. */
  zone: string | null;
  location: string;
  notes: string;
  repeat: RepeatChoice;
  every: number;
  ends: EndsChoice;
  count: number;
  until: Day;
  /** Weekly only: 0 Sunday … 6 Saturday. */
  weekdays: number[];
  monthlyBy: MonthlyBy;
  alert: number | null;
}

/** A new event on `day`: all day when `minutes` is null, else an hour from there, on this computer's clock. */
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
    zone: hereZone(),
    location: "",
    notes: "",
    repeat: "none",
    every: 1,
    ends: "never",
    count: 10,
    until: addDays(day, 30),
    weekdays: [],
    monthlyBy: "date",
    alert: null,
  };
}

/** The weekday of the month `day` is on: the 1st to 4th, or the last (a 5th, which not every month has). */
export function nthOf(day: Day): NthDay {
  const n = Math.ceil(Number(day.slice(8, 10)) / 7);
  return { n: n === 5 ? -1 : n, day: weekday(day) };
}

/**
 * The draft of one time of an event: `at` is that occurrence's start and end
 * on the event's own clock (the repeat's first when it is left out).
 */
export function draftOf(event: CalEvent, calendarId: string, at?: { start: string; end: string }): Draft {
  const start = at?.start ?? event.start;
  const end = at?.end ?? event.end;
  const startDay = dayPart(start);
  const lastDay = event.allDay ? addDays(dayPart(end), -1) : dayPart(end);
  const rule = event.repeat;
  const simple = rule !== null && isSimpleRepeat(rule);
  const repeat: RepeatChoice = rule && simple ? rule.freq : rule || event.rawRule !== null ? "custom" : "none";
  return {
    title: event.title,
    calendarId,
    allDay: event.allDay,
    startDay,
    startMinutes: event.allDay ? 9 * 60 : minuteOfDay(start),
    endDay: lastDay < startDay ? startDay : lastDay,
    endMinutes: event.allDay ? 10 * 60 : minuteOfDay(end),
    zone: event.allDay ? hereZone() : event.zone,
    location: event.location,
    notes: event.notes,
    repeat,
    every: rule?.interval ?? 1,
    ends: rule?.count !== undefined ? "count" : rule?.until !== undefined ? "until" : "never",
    count: rule?.count ?? 10,
    until: rule?.until ?? addDays(startDay, 30),
    weekdays: rule?.freq === "weekly" ? (rule.byDay ?? []) : [],
    monthlyBy: rule?.freq === "monthly" && (rule.byNth?.length ?? 0) > 0 ? "weekday" : "date",
    alert: event.alert,
  };
}

/** The wall-clock start and end a draft says; the end of an all-day event is the day after its last. */
export function timesOf(draft: Draft): { start: string; end: string } {
  if (draft.allDay) return { start: `${draft.startDay}T00:00`, end: `${addDays(draft.endDay < draft.startDay ? draft.startDay : draft.endDay, 1)}T00:00` };
  return { start: addMinutes(`${draft.startDay}T00:00`, draft.startMinutes), end: addMinutes(`${draft.endDay}T00:00`, draft.endMinutes) };
}

/** The repeat a draft chooses, or null (none), or undefined (a rule the sheet does not edit stays as it is). */
export function repeatOf(draft: Draft): Repeat | null | undefined {
  if (draft.repeat === "none") return null;
  if (draft.repeat === "custom") return undefined;
  const rule: Repeat = { freq: draft.repeat, interval: Math.max(1, Math.round(draft.every)) };
  if (draft.ends === "count") rule.count = Math.max(1, Math.round(draft.count));
  if (draft.ends === "until") rule.until = draft.until;
  if (draft.repeat === "weekly" && draft.weekdays.length > 0) rule.byDay = [...new Set(draft.weekdays)].sort((a, b) => a - b);
  if (draft.repeat === "monthly" && draft.monthlyBy === "weekday") rule.byNth = [nthOf(draft.startDay)];
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
    zone: draft.allDay ? null : draft.zone,
    location: draft.location,
    notes: draft.notes,
    alert: draft.alert,
    ...(repeat === undefined ? {} : { repeat }),
  };
}

/** Whether two drafts choose different repeats (a change to one time of a repeat can't change its repeat). */
export const repeatChanged = (before: Draft, after: Draft): boolean => JSON.stringify(repeatOf(before)) !== JSON.stringify(repeatOf(after));

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
