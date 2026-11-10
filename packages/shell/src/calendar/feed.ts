/**
 * The calendars as the shell sees them: the same folder of .ics files the
 * Calendar app writes, read into memory and read again when it changes (the
 * app saved, an agent added an event, a sync tool dropped a file in). The
 * reminders schedule from it and the notification center's month marks the
 * days that have events from it.
 */

import type { Day } from "../shared/calendar/dates.ts";
import { busyDays } from "../shared/calendar/recurrence.ts";
import { readSidecar } from "../shared/calendar/sidecar.ts";
import { CalendarStore } from "../shared/calendar/store.ts";
import type { Calendar } from "../shared/calendar/types.ts";
import { watchCalendars } from "../shared/calendar/watch.ts";

export class CalendarFeed {
  private calendars: Calendar[] = [];
  private hidden = new Set<string>();
  private version = 0;
  private readonly listeners = new Set<() => void>();
  private readonly store: CalendarStore;

  constructor(readonly root: string) {
    this.store = new CalendarStore(root);
  }

  /** Reads now and follows the folder; the returned function stops following. */
  start(): () => void {
    this.reload();
    return watchCalendars(this.root, () => this.reload());
  }

  reload(): void {
    try {
      this.calendars = this.store.scan().calendars;
      this.hidden = new Set(readSidecar(this.root).hidden);
    } catch (error) {
      console.error("dashi-shell: reading the calendars failed:", error instanceof Error ? error.message : error);
      return;
    }
    this.version++;
    for (const listener of [...this.listeners]) listener();
  }

  /** Every calendar, hidden or not (alerts come from all of them). */
  all(): readonly Calendar[] {
    return this.calendars;
  }

  /** The days in [from, to) that have an event in a calendar the person has not hidden. */
  busyDays(from: Day, to: Day): Set<Day> {
    return busyDays(this.calendars, from, to, this.hidden);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = (): number => this.version;
}
