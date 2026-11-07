/**
 * Calendar's state: the calendars read from disk, which are hidden, which view
 * and day are shown, and the day picked. A store with the usual
 * subscribe/getSnapshot pair over a `CalendarStore`. Every change goes to the
 * files at once (an event is saved when it is dropped on the grid, named in
 * place, or saved in the sheet), and a change made elsewhere (`reload`, from
 * the folder watcher) simply replaces what is held. A change to an event can
 * be taken back with Edit › Undo (history.ts); a change to one time of a
 * repeat is written as edits.ts says.
 */

import { UndoStack } from "@dashi/ui";

import { addDays, type Day, dayOf, type Local } from "./dates.ts";
import { changeOccurrence, deleteOccurrence, duplicateOf, type EditResult, type Scope } from "./edits.ts";
import type { EventInput } from "./event.ts";
import { type EventChange, eventStep } from "./history.ts";
import { step, type View, viewDays, viewRange } from "./layout.ts";
import { busyDays, occurrencesIn } from "./recurrence.ts";
import { readSidecar, writeSidecar } from "./sidecar.ts";
import type { CalendarStore } from "./store.ts";
import { type CalEvent, type Calendar, CalendarError, type Occurrence } from "./types.ts";

export interface CalendarState {
  calendars: Calendar[];
  /** Files that could not be read, and events kept but not shown. */
  problems: string[];
  /** Calendar ids the person has turned off. */
  hidden: string[];
  view: View;
  /** The day the view is on (any day of the month or week shown). */
  anchor: Day;
  /** The day picked (a click, the arrows): where New Event and Return make one. Always one the view shows. */
  selected: Day;
  today: Day;
  /** The last thing that went wrong, for a line in the window. */
  error: string | null;
  /** The last thing that went well and is worth saying (an import). */
  notice: string | null;
}

/** One time of an event, as the window names it to the model. */
export interface OccurrenceRef {
  calendarId: string;
  uid: string;
  /** Null for an event that happens once. */
  recurrenceId: Local | null;
}

/** How long a notice that only informs stays (Files' `NOTICE_FADE_MS`). */
export const NOTICE_FADE_MS = 5000;

export class CalendarModel {
  private state: CalendarState;
  private readonly listeners = new Set<() => void>();
  private cache: { key: string; occurrences: Occurrence[] } | null = null;
  private busyCache: { key: string; days: Set<Day> } | null = null;
  /** Edit › Undo and Redo: changes to events. */
  readonly undo = new UndoStack();

  private noticeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    readonly store: CalendarStore,
    private readonly clock: () => Date = () => new Date(),
    start?: { view?: View; day?: Day },
    /** How long a notice that only informs stays (errors stay until dismissed). */
    private readonly noticeFadeMs = NOTICE_FADE_MS,
  ) {
    const today = dayOf(clock());
    const day = start?.day ?? today;
    this.state = { calendars: [], problems: [], hidden: [], view: start?.view ?? "month", anchor: day, selected: day, today, error: null, notice: null };
    this.reload();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): CalendarState => this.state;

  private set(change: Partial<CalendarState>): void {
    if (change.notice !== undefined && change.notice !== this.state.notice) this.fadeNotice(change.notice);
    this.state = { ...this.state, ...change };
    if (change.calendars !== undefined || change.hidden !== undefined || change.view !== undefined || change.anchor !== undefined) {
      this.cache = null;
      if (change.calendars !== undefined || change.hidden !== undefined) this.busyCache = null;
    }
    for (const listener of [...this.listeners]) listener();
  }

  /** A notice that only informs ("Imported 6 events…") goes after a while, as Files' do; a newer one starts its own time. */
  private fadeNotice(notice: string | null): void {
    if (this.noticeTimer) clearTimeout(this.noticeTimer);
    this.noticeTimer = null;
    if (notice === null) return;
    this.noticeTimer = setTimeout(() => {
      this.noticeTimer = null;
      if (this.state.notice === notice) this.set({ notice: null });
    }, this.noticeFadeMs);
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

  /** Reads only which calendars are hidden (the folder's sidecar changed, no calendar did). */
  reloadHidden(): void {
    const known = new Set(this.state.calendars.map((calendar) => calendar.id));
    const hidden = readSidecar(this.store.root).hidden.filter((id) => known.has(id));
    if (hidden.join("\n") !== this.state.hidden.join("\n")) this.set({ hidden });
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
      this.reload();
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
    if (view !== this.state.view) this.set({ view, anchor: this.state.selected });
  }

  /** Shows `day`, in `view` when one is given, and picks it. */
  goTo(day: Day, view?: View): void {
    this.set({ anchor: day, selected: day, ...(view ? { view } : {}) });
  }

  goToday(): void {
    const today = dayOf(this.clock());
    this.set({ anchor: today, selected: today, today });
  }

  step(direction: -1 | 1): void {
    const anchor = step(this.state.view, this.state.anchor, direction);
    this.set({ anchor, selected: anchor });
  }

  /** Picks a day the view shows. */
  select(day: Day): void {
    if (day !== this.state.selected) this.set({ selected: day });
  }

  /** Moves the picked day by `days` (the arrows), taking the view along when it leaves it. */
  moveSelection(days: number, firstDay: number): void {
    const selected = addDays(this.state.selected, days);
    const shown = viewDays(this.state.view, this.state.anchor, firstDay);
    const inView = this.state.view === "month" ? selected.slice(0, 7) === this.state.anchor.slice(0, 7) : shown.includes(selected);
    this.set(inView ? { selected } : { selected, anchor: selected });
  }

  // ---- What is shown ---------------------------------------------------------------

  isVisible(calendarId: string): boolean {
    return !this.state.hidden.includes(calendarId);
  }

  /** Shows or hides a calendar: held at once, and written to the sidecar (no calendar is read again). */
  toggle(calendarId: string): void {
    const hidden = this.isVisible(calendarId) ? [...this.state.hidden, calendarId] : this.state.hidden.filter((id) => id !== calendarId);
    try {
      writeSidecar(this.store.root, { version: 1, hidden });
      this.set({ hidden, error: null });
    } catch {
      this.set({ error: "Hiding the calendar failed: the calendars folder could not be written." });
    }
  }

  /**
   * Shows a hidden calendar again and says so: a new event is about to go
   * into it (target.ts), and must not vanish there. True when it shows.
   */
  reveal(calendarId: string): boolean {
    if (this.isVisible(calendarId)) return true;
    this.toggle(calendarId);
    if (!this.isVisible(calendarId)) return false;
    const name = this.calendar(calendarId)?.name ?? calendarId;
    this.set({ notice: `“${name}” is shown again, so the new event can be seen there.` });
    return true;
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

  /** The days of [from, to) that have events in visible calendars (the mini month's dots); held until the calendars change. */
  busy(from: Day, to: Day): Set<Day> {
    const key = `${from}|${to}`;
    if (this.busyCache?.key === key) return this.busyCache.days;
    const days = busyDays(this.state.calendars, from, to, new Set(this.state.hidden));
    this.busyCache = { key, days };
    return days;
  }

  calendar(id: string): Calendar | undefined {
    return this.state.calendars.find((calendar) => calendar.id === id);
  }

  /** The event as held now (a repeat's own, not one occurrence's). */
  event(calendarId: string, uid: string): CalEvent | undefined {
    return this.calendar(calendarId)?.events.find((each) => each.uid === uid);
  }

  // ---- Changes ------------------------------------------------------------------------

  /** Adds an event to `calendarId`. The new event, or undefined when it could not be saved. */
  addEvent(calendarId: string, input: EventInput): CalEvent | undefined {
    const saved = this.attempt("Saving the event", () => this.store.add(calendarId, input));
    if (saved) this.remember([{ before: null, after: { calendarId, event: saved } }]);
    return saved;
  }

  /** Adds an event to `calendarId`, or edits `uid` there (moving it to `moveTo` when that differs). True when it was saved. */
  saveEvent(calendarId: string, uid: string | null, input: EventInput, moveTo?: string): boolean {
    if (uid === null) return this.addEvent(calendarId, input) !== undefined;
    return this.changeOccurrence({ calendarId, uid, recurrenceId: null }, input, "all", { moveTo });
  }

  /**
   * Changes one time of an event to `input` (times in the event's zone), for
   * `scope` when it repeats. `moveTo` puts the event (or the new repeat, for
   * "following") in another calendar; one occurrence alone stays with its
   * repeat. `name` is the step's in Edit › Undo ("Move Event").
   */
  changeOccurrence(ref: OccurrenceRef, input: EventInput, scope: Scope, options: { moveTo?: string; name?: string } = {}): boolean {
    return this.apply(ref, "Saving the event", options, (event) => changeOccurrence(event, ref.recurrenceId, input, scope), scope);
  }

  /** Deletes one time of an event, for `scope` when it repeats (the event itself when it happens once). */
  deleteOccurrence(ref: OccurrenceRef, scope: Scope): boolean {
    return this.apply(ref, "Deleting the event", { name: "Delete Event" }, (event) => deleteOccurrence(event, ref.recurrenceId, scope), scope);
  }

  /** Deletes an event and every time it happens. */
  deleteEvent(calendarId: string, uid: string): boolean {
    return this.deleteOccurrence({ calendarId, uid, recurrenceId: null }, "all");
  }

  /** A copy of one time of an event, beside it as an event of its own. */
  duplicate(occurrence: Pick<Occurrence, "calendarId" | "event">): CalEvent | undefined {
    const copy = duplicateOf(occurrence.event);
    const saved = this.attempt("Duplicating the event", () => {
      this.store.put(occurrence.calendarId, copy);
      return copy;
    });
    if (saved) this.remember([{ before: null, after: { calendarId: occurrence.calendarId, event: saved } }], "Duplicate Event");
    return saved;
  }

  private apply(ref: OccurrenceRef, what: string, options: { moveTo?: string; name?: string }, edit: (event: CalEvent) => EditResult, scope: Scope): boolean {
    const before = this.held(ref.calendarId, ref.uid);
    if (!before) {
      this.set({ error: "That event is not in the calendar any more." });
      return false;
    }
    const changes: EventChange[] = [];
    const done = this.attempt(what, () => {
      const result = edit(before.event);
      const whole = ref.recurrenceId === null || scope === "all";
      const home = options.moveTo !== undefined && whole ? options.moveTo : ref.calendarId;
      if (result.event) {
        // The new place first, so a failure never loses the event.
        this.store.put(home, result.event);
        if (home !== ref.calendarId) this.store.delete(ref.calendarId, ref.uid);
        changes.push({ before, after: { calendarId: home, event: result.event } });
      } else {
        this.store.delete(ref.calendarId, ref.uid);
        changes.push({ before, after: null });
      }
      if (result.added) {
        const where = options.moveTo ?? ref.calendarId;
        this.store.put(where, result.added);
        changes.push({ before: null, after: { calendarId: where, event: result.added } });
      }
      return true;
    });
    // What was written before a failure is still taken back by Undo.
    this.remember(changes, options.name);
    return done === true;
  }

  /** Edit › Undo or Redo; a step that fails says why in the window. */
  async undoStep(way: "undo" | "redo"): Promise<void> {
    try {
      await (way === "undo" ? this.undo.undo() : this.undo.redo());
    } catch (error) {
      this.set({ error: this.message(error, "That can't be undone: the calendars folder could not be written.") });
      this.reload();
    }
  }

  /** The event as it is on disk now, for its step. */
  private held(calendarId: string, uid: string): { calendarId: string; event: CalEvent } | null {
    const event = this.event(calendarId, uid);
    return event ? { calendarId, event: structuredClone(event) } : null;
  }

  private remember(changes: readonly EventChange[], name?: string): void {
    const steps = changes.filter((change) => change.before || change.after);
    const first = steps[0];
    if (!first) return;
    const reload = (): void => this.reload();
    if (steps.length === 1) return this.undo.push(eventStep(first, this.store, reload, name));
    this.undo.group(name ?? eventStep(first, this.store, reload).name, () => {
      for (const change of steps) this.undo.push(eventStep(change, this.store, reload));
    });
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

  /** Imports an .ics file's text into the calendar `into`, or as a calendar of its own. */
  importText(text: string, fallbackName: string, into?: string): void {
    const result = this.attempt("Importing", () => this.store.importText(text, fallbackName, into));
    if (!result) return;
    const count = `${result.imported} ${result.imported === 1 ? "event" : "events"}`;
    const there = result.duplicates > 0 ? ` ${result.duplicates} ${result.duplicates === 1 ? "was" : "were"} there already.` : "";
    const skipped = result.skipped > 0 ? ` ${result.skipped} couldn't be shown and ${result.skipped === 1 ? "is" : "are"} kept in the file.` : "";
    this.set({ notice: `Imported ${count} into “${result.calendar.name}”.${there}${skipped}` });
  }

  fail(message: string): void {
    this.set({ error: message });
  }

  say(message: string): void {
    this.set({ notice: message, error: null });
  }
}
