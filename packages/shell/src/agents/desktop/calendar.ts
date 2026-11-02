/**
 * The Calendar app's files as agents see them. Calendars are .ics files under
 * ~/.local/share/dashi/calendars (`DASHI_CALENDAR_DIR` moves them), read and
 * written through the same store the app uses, so the app (and the shell's
 * reminders) see an agent's event as they see any program's. What an event
 * says is never put in the menu bar: the status line names only what is being
 * done.
 */

import { addDays, addMinutes, dayPart, type Local } from "../../../apps/calendar/dates.ts";
import { formatDuration } from "../../../apps/calendar/ics.ts";
import { occurrencesIn } from "../../../apps/calendar/recurrence.ts";
import { readSidecar } from "../../../apps/calendar/sidecar.ts";
import { CalendarStore, defaultRoot } from "../../../apps/calendar/store.ts";
import { type Calendar, CalendarError, type Occurrence } from "../../../apps/calendar/types.ts";
import { json, type RunContext, type ToolResult, text, toolError } from "../context.ts";

/** The most of an event's notes one listing returns. */
export const NOTES_CHARS = 300;

function attempt(action: (store: CalendarStore) => ToolResult): ToolResult {
  try {
    return action(new CalendarStore(defaultRoot()));
  } catch (error) {
    return toolError(error instanceof CalendarError ? error.message : "The calendars folder could not be read or written.");
  }
}

/** The calendar a name or id points at (case ignored); null when there is none. */
function find(calendars: readonly Calendar[], name: string): Calendar | null {
  const lower = name.toLowerCase();
  return calendars.find((calendar) => calendar.id.toLowerCase() === lower) ?? calendars.find((calendar) => calendar.name.toLowerCase() === lower) ?? null;
}

export function listCalendars(ctx: RunContext): ToolResult {
  ctx.status("Reading your calendars");
  return attempt((store) => {
    const hidden = new Set(readSidecar(store.root).hidden);
    const { calendars } = store.scan();
    return json({
      calendars: calendars.map((calendar) => ({
        id: calendar.id,
        name: calendar.name,
        color: calendar.color,
        hidden: hidden.has(calendar.id),
        events: calendar.events.length,
      })),
    });
  });
}

function describe(occurrence: Occurrence, name: string) {
  const { event } = occurrence;
  const notes = event.notes.length > NOTES_CHARS ? `${event.notes.slice(0, NOTES_CHARS)}…` : event.notes;
  return {
    uid: event.uid,
    calendar: name,
    calendarId: occurrence.calendarId,
    title: event.title,
    allDay: event.allDay,
    // An all-day event is written as days, and its end is its last day.
    start: event.allDay ? dayPart(occurrence.start) : occurrence.start,
    end: event.allDay ? addDays(dayPart(occurrence.end), -1) : occurrence.end,
    location: event.location,
    notes,
    repeats: event.repeat
      ? `${event.repeat.freq}${event.repeat.interval > 1 ? ` every ${event.repeat.interval}` : ""}`
      : event.rawRule !== null
        ? "custom"
        : null,
    alert: event.alert === null ? null : event.alert >= 0 ? `${formatDuration(event.alert)} before` : `${formatDuration(-event.alert)} after`,
  };
}

export function listEvents(call: { from: string; to: string; calendar: string | null; limit: number }, ctx: RunContext): ToolResult {
  ctx.status("Reading your calendar");
  return attempt((store) => {
    const { calendars } = store.scan();
    let chosen: readonly Calendar[] = calendars;
    if (call.calendar !== null) {
      const one = find(calendars, call.calendar);
      if (!one) return toolError(`There is no calendar called “${call.calendar}”; list_calendars names them.`);
      chosen = [one];
    }
    const names = new Map(calendars.map((calendar) => [calendar.id, calendar.name]));
    const found = occurrencesIn(chosen, call.from, addDays(call.to, 1));
    return json({
      events: found.slice(0, call.limit).map((occurrence) => describe(occurrence, names.get(occurrence.calendarId) ?? occurrence.calendarId)),
      total: found.length,
    });
  });
}

export function createEvent(
  call: {
    title: string;
    start: string;
    end: string | null;
    calendar: string | null;
    location: string;
    notes: string;
    repeat: { freq: "daily" | "weekly" | "monthly" | "yearly"; interval: number; count?: number; until?: string } | null;
    alert: number | null;
  },
  ctx: RunContext,
): ToolResult {
  ctx.status("Adding an event");
  return attempt((store) => {
    const { calendars } = store.ensureDefault();
    let target: Calendar | null;
    if (call.calendar !== null) {
      target = find(calendars, call.calendar);
      if (!target) return toolError(`There is no calendar called “${call.calendar}”; list_calendars names them.`);
    } else target = calendars.find((calendar) => calendar.name === "Home") ?? calendars[0] ?? null;
    if (!target) return toolError("There is no calendar to add the event to.");

    const allDay = !call.start.includes("T");
    const start: Local = allDay ? `${call.start}T00:00` : call.start;
    const end: Local = allDay ? `${addDays(call.end ?? call.start, 1)}T00:00` : (call.end ?? addMinutes(start, 60));
    const event = store.add(target.id, {
      title: call.title,
      allDay,
      start,
      end,
      location: call.location,
      notes: call.notes,
      repeat: call.repeat,
      alert: call.alert,
    });
    return text(`Added “${event.title}” (${allDay ? dayPart(start) : start}) to ${target.name}.`, {
      uid: event.uid,
      calendar: target.name,
      calendarId: target.id,
    });
  });
}
