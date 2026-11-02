/**
 * Calendar's state: the calendars read from disk, which are hidden, which view
 * and day are shown. A store with the usual subscribe/getSnapshot pair over a
 * `CalendarStore`. Every change goes to the files at once (there is no draft:
 * an event is saved when the sheet's Save is pressed), and a change made
 * elsewhere (`reload`, from the folder watcher) simply replaces what is held.
 */

import { type Day, dayOf } from "./dates.ts";
import type { EventInput } from "./event.ts";
import { type View, viewRange, step } from "./layout.ts";
import { busyDays, occurrencesIn } from "./recurrence.ts";
import { readSidecar, writeSidecar } from "./sidecar.ts";
import type { CalendarStore } from "./store.ts";
import { type Calendar, CalendarError, type Occurrence } from "./types.ts";

export interface CalendarState {
  calendars: Calendar[];
  /** Files that could not be read, and events kept but not shown. */
  problems: string[];
  /** Calendar ids the person has turned off. */
  hidden: string[];
  view: View;
  /** The day the view is on (any day of the month or week shown). */
  anchor: Day;
  today: Day;
  /** The last thing that went wrong, for a line in the window. */
  error: string | null;
  /** The last thing that went well and is worth saying (an import). */
  notice: string | null;
}

export class CalendarModel {
  private state: CalendarState;
  private readonly listeners = new Set<() => void>();
  private cache: { key: string; occurrences: Occurrence[] } | null = null;

  constructor(
    readonly store: CalendarStore,
    private readonly clock: () => Date = () => new Date(),
    start?: { view?: View; day?: Day },
  ) {
    const today = dayOf(clock());
    this.state = { calendars: [], problems: [], hidden: [], view: start?.view ?? "month", anchor: start?.day ?? today, today, error: null, notice: null };
    this.reload();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): CalendarState => this.state;

  private set(change: Partial<CalendarState>): void {
    this.state = { ...this.state, ...change };
    this.cache = null;
    for (const listener of [...this.listeners]) listener();
  }

  /** Reads the folder again. */
  reload(): void {
    try {
      const { calendars, problems } = this.store.ensureDefault();
      const known = new Set(calendars.map((calendar) => calendar.id));
      this.set({ calendars, problems, hidden: readSidecar(this.store.root).hidden.filter((id) => known.has(id)) });
    } catch (error) {
      this.set({ error: this.message(error, "The calendars could not be read.") });
    }
  }

  private message(error: unknown, fallback: string): string {
    return error instanceof CalendarError ? error.message : fallback;
  }

  /** Runs a change to the files, then reads them again; says why when it fails. */
  private attempt<T>(what: string, run: () => T): T | undefined {
    try {
      const result = run();
      this.state = { ...this.state, error: null };
      this.reload();
      return result;
    } catch (error) {
      this.set({ error: this.message(error, `${what} failed: the calendars folder could not be written.`) });
      return undefined;
    }
  }

  dismissMessages(): void {
    if (this.state.error !== null || this.state.notice !== null) this.set({ error: null, notice: null });
  }

  /** Midnight passed: Today moves. */
  tick(): void {
    const today = dayOf(this.clock());
    if (today !== this.state.today) this.set({ today });
  }

  // ---- Where the view is -------------------------------------------------------

  setView(view: View): void {
    if (view !== this.state.view) this.set({ view });
  }

  /** Shows `day`, in `view` when one is given. */
  goTo(day: Day, view?: View): void {
    this.set({ anchor: day, ...(view ? { view } : {}) });
  }

  goToday(): void {
    this.set({ anchor: dayOf(this.clock()), today: dayOf(this.clock()) });
  }

  step(direction: -1 | 1): void {
    this.set({ anchor: step(this.state.view, this.state.anchor, direction) });
  }

  // ---- What is shown ---------------------------------------------------------------

  isVisible(calendarId: string): boolean {
    return !this.state.hidden.includes(calendarId);
  }

  toggle(calendarId: string): void {
    const hidden = this.isVisible(calendarId) ? [...this.state.hidden, calendarId] : this.state.hidden.filter((id) => id !== calendarId);
    this.attempt("Hiding the calendar", () => writeSidecar(this.store.root, { version: 1, hidden }));
  }

  /** The occurrences the view shows, in visible calendars. */
  occurrences(firstDay: number): Occurrence[] {
    const { view, anchor, calendars, hidden } = this.state;
    const key = `${view}|${anchor}|${firstDay}`;
    if (this.cache?.key === key) return this.cache.occurrences;
    const { from, to } = viewRange(view, anchor, firstDay);
    const occurrences = occurrencesIn(calendars, from, to, new Set(hidden));
    this.cache = { key, occurrences };
    return occurrences;
  }

  /** The days of [from, to) that have events in visible calendars (the mini month's dots). */
  busy(from: Day, to: Day): Set<Day> {
    return busyDays(this.state.calendars, from, to, new Set(this.state.hidden));
  }

  calendar(id: string): Calendar | undefined {
    return this.state.calendars.find((calendar) => calendar.id === id);
  }

  // ---- Changes ------------------------------------------------------------------------

  /** Adds an event to `calendarId`, or edits `uid` there (moving it to `moveTo` when that differs). True when it was saved. */
  saveEvent(calendarId: string, uid: string | null, input: EventInput, moveTo?: string): boolean {
    return (
      this.attempt("Saving the event", () => (uid === null ? this.store.add(calendarId, input) : this.store.update(calendarId, uid, input, moveTo))) !==
      undefined
    );
  }

  deleteEvent(calendarId: string, uid: string): boolean {
    return this.attempt("Deleting the event", () => this.store.delete(calendarId, uid)) !== undefined || this.state.error === null;
  }

  /** Deletes one occurrence of a repeating event. */
  skipOccurrence(calendarId: string, uid: string, start: string): void {
    this.attempt("Deleting the event", () => this.store.skip(calendarId, uid, start));
  }

  createCalendar(name: string, color?: string): Calendar | undefined {
    return this.attempt("Making the calendar", () => this.store.create(name, color));
  }

  renameCalendar(id: string, name: string): void {
    this.attempt("Renaming the calendar", () => this.store.rename(id, name));
  }

  recolorCalendar(id: string, color: string): void {
    this.attempt("Coloring the calendar", () => this.store.recolor(id, color));
  }

  removeCalendar(id: string): void {
    this.attempt("Deleting the calendar", () => {
      this.store.remove(id);
      if (this.state.hidden.includes(id)) writeSidecar(this.store.root, { version: 1, hidden: this.state.hidden.filter((each) => each !== id) });
    });
  }

  /** Imports an .ics file's text as a calendar of its own. */
  importText(text: string, fallbackName: string): void {
    const result = this.attempt("Importing", () => this.store.importText(text, fallbackName));
    if (!result) return;
    const skipped = result.skipped > 0 ? ` ${result.skipped} could not be shown and were kept in the file.` : "";
    this.set({ notice: `Imported ${result.imported} ${result.imported === 1 ? "event" : "events"} into “${result.calendar.name}”.${skipped}` });
  }

  fail(message: string): void {
    this.set({ error: message });
  }
}
