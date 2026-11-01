/**
 * When alerts fire and what they say. An event's alert is minutes before its
 * start; a repeating event has one per occurrence. Pure: the shell's reminders
 * (src/calendar/reminders.ts) decide when to look and what to post, from this.
 */

import { type ClockPrefs, formatTime } from "../../src/clock.ts";
import { addDays, addMinutes, dayOf, dayPart, instantOf, type Local, localOf } from "./dates.ts";
import { occurrencesOf } from "./recurrence.ts";
import type { Calendar } from "./types.ts";

export interface Alert {
  /** One per calendar, event, and occurrence: what remembers that it fired. */
  key: string;
  fireAt: Date;
  calendarId: string;
  calendar: string;
  uid: string;
  title: string;
  allDay: boolean;
  /** The occurrence. */
  start: Local;
  end: Local;
  location: string;
}

/** The alerts that fire after `from` and up to `to` (both included at the end), soonest first. */
export function alertsBetween(calendars: readonly Pick<Calendar, "id" | "name" | "events">[], from: Date, to: Date): Alert[] {
  const out: Alert[] = [];
  for (const calendar of calendars) {
    for (const event of calendar.events) {
      if (event.alert === null) continue;
      // The wall clock and the instants differ by at most a clock change; look two hours wider and decide by instant.
      const lo = addMinutes(localOf(from), event.alert - 120);
      const hi = addMinutes(localOf(to), event.alert + 121);
      for (const occurrence of occurrencesOf(event, calendar.id, lo, hi)) {
        const fireAt = new Date(instantOf(occurrence.start).getTime() - event.alert * 60_000);
        if (fireAt.getTime() <= from.getTime() || fireAt.getTime() > to.getTime()) continue;
        out.push({
          key: `${calendar.id}|${event.uid}|${occurrence.start}`,
          fireAt,
          calendarId: calendar.id,
          calendar: calendar.name,
          uid: event.uid,
          title: event.title,
          allDay: event.allDay,
          start: occurrence.start,
          end: occurrence.end,
          location: event.location,
        });
      }
    }
  }
  return out.sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime() || a.key.localeCompare(b.key));
}

/** "In 15 minutes", "Today at 3:00 PM", "Tomorrow at 9:00 AM", "Nov 6 at 9:00 AM"; "All day" / "Tomorrow, all day" for an all-day event. */
export function whenText(alert: Pick<Alert, "start" | "allDay">, now: Date, prefs: ClockPrefs): string {
  const start = instantOf(alert.start);
  const today = dayOf(now);
  const day = dayPart(alert.start);
  const dayName =
    day === today
      ? "Today"
      : day === addDays(today, 1)
        ? "Tomorrow"
        : day === addDays(today, -1)
          ? "Yesterday"
          : new Intl.DateTimeFormat(prefs.locale, { month: "short", day: "numeric" }).format(start);
  if (alert.allDay) return dayName === "Today" ? "All day today" : `${dayName}, all day`;
  const ahead = Math.round((start.getTime() - now.getTime()) / 60_000);
  if (ahead >= 1 && ahead < 60) return ahead === 1 ? "In 1 minute" : `In ${ahead} minutes`;
  if (ahead <= 0 && ahead > -60) return "Starting now";
  return `${dayName} at ${formatTime(start, prefs)}`;
}

/** What the notification says: the event's title, then when and where. */
export function alertMessage(alert: Alert, now: Date, prefs: ClockPrefs): { summary: string; body: string } {
  const where = alert.location !== "" ? ` · ${alert.location}` : "";
  return { summary: alert.title || "Event", body: `${whenText(alert, now, prefs)}${where}` };
}
