/**
 * Where the calendar window is, and what it says: the view and the day it is
 * on, the day picked, today, and the one line of error or notice. A store
 * with the usual subscribe/getSnapshot pair; CalendarModel (model.ts) adds
 * the calendars and their events to it.
 */

import { addDays, type Day, dayOf } from "../../../src/shared/calendar/index.ts";
import { step, type View, viewDays } from "./layout.ts";
import { type CalendarState, NOTICE_FADE_MS } from "./state.ts";

export class CalendarWindowState {
  protected state: CalendarState;
  private readonly listeners = new Set<() => void>();
  private noticeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    protected readonly clock: () => Date = () => new Date(),
    start?: { view?: View; day?: Day },
    /** How long a notice that only informs stays (errors stay until dismissed). */
    private readonly noticeFadeMs = NOTICE_FADE_MS,
  ) {
    const today = dayOf(clock());
    const day = start?.day ?? today;
    this.state = { calendars: [], problems: [], hidden: [], view: start?.view ?? "month", anchor: day, selected: day, today, error: null, notice: null };
  }

  /** A change was made to the state: what was derived from it is stale. */
  protected changed(_change: Partial<CalendarState>): void {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): CalendarState => this.state;

  protected set(change: Partial<CalendarState>): void {
    if (change.notice !== undefined && change.notice !== this.state.notice) this.fadeNotice(change.notice);
    this.state = { ...this.state, ...change };
    this.changed(change);
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

  dismissMessages(): void {
    if (this.state.error !== null || this.state.notice !== null) this.set({ error: null, notice: null });
  }

  /** Midnight passed: Today moves. */
  tick(): void {
    const today = dayOf(this.clock());
    if (today !== this.state.today) this.set({ today });
  }

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

  fail(message: string): void {
    this.set({ error: message });
  }

  say(message: string): void {
    this.set({ notice: message, error: null });
  }
}
