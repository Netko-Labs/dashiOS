/**
 * Calendar's alerts, fired by the shell, so they come when the Calendar
 * window is closed and the app is not running. It looks at the calendars the
 * feed holds, sets one timer for the soonest alert (never longer than a
 * minute, so a sleep or a clock change is noticed), and posts what is due to
 * the notification store. What has fired is written down (`calendar-alerts.json`
 * in the state folder), so a restarted shell does not announce an event twice.
 * An alert missed while the computer was off is still posted if the event has
 * not ended; Do Not Disturb is the store's business.
 */

import { mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { type Alert, alertMessage, alertsBetween } from "../../apps/calendar/alerts.ts";
import { dayPart, instantOf } from "../../apps/calendar/dates.ts";
import { iconPath } from "../apps.ts";
import { type NotificationStore, SHELL_SENDER } from "../notifications/store.ts";
import type { NotifyInput } from "../notifications/types.ts";
import { writeAtomic } from "../shared/fs/atomic.ts";
import { type ClockPrefs, clockPrefs } from "../shared/time/clock.ts";
import type { CalendarFeed } from "./feed.ts";

export const APP_ID = "dev.dashi.calendar";
/** An alert this long overdue is still posted if its event has not ended. */
export const MISSED_MS = 24 * 3_600_000;
/** How far ahead the next alert is looked for. */
const LOOKAHEAD_MS = 26 * 3_600_000;
const MAX_WAIT_MS = 60_000;
const MIN_WAIT_MS = 250;
/** How long a fired alert is remembered. */
const REMEMBER_MS = 3 * 86_400_000;
/** How long a banner stays: an alert is worth longer than the default five seconds. */
const BANNER_MS = 15_000;

export function firedPath(env: Readonly<Record<string, string | undefined>> = process.env, home: string = homedir()): string {
  return join(env.XDG_STATE_HOME || join(home, ".local", "state"), "dashi", "calendar-alerts.json");
}

/** What is remembered as fired: alert key to when. Anything of the wrong shape is dropped. */
export function parseFired(value: unknown): Map<string, number> {
  const out = new Map<string, number>();
  const fired = typeof value === "object" && value !== null ? (value as Record<string, unknown>).fired : undefined;
  if (typeof fired !== "object" || fired === null || Array.isArray(fired)) return out;
  for (const [key, at] of Object.entries(fired)) if (typeof at === "number" && Number.isFinite(at) && key.length < 600) out.set(key, at);
  return out;
}

export interface RemindersOptions {
  feed: Pick<CalendarFeed, "all" | "subscribe">;
  notifications: Pick<NotificationStore, "notify" | "onEvent">;
  /** Called when the person clicks an alert's banner. */
  onOpen: (day: string) => void;
  now?: () => Date;
  prefs?: () => ClockPrefs;
  /** Where the fired alerts are written down; null keeps them in memory only. */
  statePath?: string | null;
  setTimer?: (run: () => void, ms: number) => () => void;
}

const timeout = (run: () => void, ms: number): (() => void) => {
  const timer = setTimeout(run, ms);
  timer.unref?.();
  return () => clearTimeout(timer);
};

export function noticeOf(alert: Alert, now: Date, prefs: ClockPrefs): NotifyInput {
  const { summary, body } = alertMessage(alert, now, prefs);
  return {
    appName: "Calendar",
    appIcon: iconPath("calendar"),
    summary,
    body,
    actions: [{ key: "default", label: "Show" }],
    urgency: "normal",
    expireTimeout: BANNER_MS,
    imagePath: "",
    desktopEntry: APP_ID,
    category: "calendar",
    transient: false,
    resident: false,
  };
}

export class Reminders {
  private fired = new Map<string, number>();
  /** Notification id to the day to show when it is clicked. */
  private readonly posted = new Map<number, string>();
  private cancel: (() => void) | null = null;
  private stops: Array<() => void> = [];
  private running = false;
  private readonly now: () => Date;
  private readonly prefs: () => ClockPrefs;
  private readonly statePath: string | null;
  private readonly setTimer: (run: () => void, ms: number) => () => void;

  constructor(private readonly options: RemindersOptions) {
    this.now = options.now ?? (() => new Date());
    this.prefs = options.prefs ?? (() => clockPrefs.getSnapshot());
    this.statePath = options.statePath === undefined ? firedPath() : options.statePath;
    this.setTimer = options.setTimer ?? timeout;
  }

  start(): () => void {
    this.running = true;
    this.load();
    this.stops.push(
      this.options.feed.subscribe(() => this.check()),
      this.options.notifications.onEvent((event) => {
        const day = this.posted.get(event.id);
        if (day === undefined) return;
        if (event.type === "action" && event.key === "default") this.options.onOpen(day);
        else if (event.type === "closed") this.posted.delete(event.id);
      }),
    );
    this.check();
    return () => this.stop();
  }

  stop(): void {
    this.running = false;
    this.cancel?.();
    this.cancel = null;
    for (const stop of this.stops.splice(0)) stop();
  }

  /** Posts what is due, then sets the timer for what comes next. */
  check(): void {
    if (!this.running) return;
    this.cancel?.();
    this.cancel = null;
    const now = this.now();
    let posted = false;
    const calendars = this.options.feed.all();
    for (const alert of alertsBetween(calendars, new Date(now.getTime() - MISSED_MS), now)) {
      if (this.fired.has(alert.key) || instantOf(alert.end).getTime() <= now.getTime()) continue;
      // Written down before it is shown: a failure after this must not post it twice.
      this.fired.set(alert.key, now.getTime());
      posted = true;
      try {
        const id = this.options.notifications.notify(noticeOf(alert, now, this.prefs()), 0, SHELL_SENDER);
        this.posted.set(id, dayPart(alert.start));
      } catch (error) {
        console.error("dashi-shell: posting a calendar alert failed:", error instanceof Error ? error.message : error);
      }
    }
    if (posted) this.save(now);
    const next = alertsBetween(calendars, now, new Date(now.getTime() + LOOKAHEAD_MS))[0];
    const wait = next ? Math.min(Math.max(next.fireAt.getTime() - now.getTime(), MIN_WAIT_MS), MAX_WAIT_MS) : MAX_WAIT_MS;
    this.cancel = this.setTimer(() => this.check(), wait);
  }

  private load(): void {
    if (this.statePath === null) return;
    try {
      this.fired = parseFired(JSON.parse(readFileSync(this.statePath, "utf8")));
    } catch {
      this.fired = new Map();
    }
  }

  private save(now: Date): void {
    for (const [key, at] of this.fired) if (now.getTime() - at > REMEMBER_MS) this.fired.delete(key);
    if (this.statePath === null) return;
    try {
      mkdirSync(dirname(this.statePath), { recursive: true });
      writeAtomic(this.statePath, `${JSON.stringify({ version: 1, fired: Object.fromEntries(this.fired) })}\n`);
    } catch (error) {
      console.error("dashi-shell: could not write down the calendar alerts that fired:", error instanceof Error ? error.message : error);
    }
  }
}
