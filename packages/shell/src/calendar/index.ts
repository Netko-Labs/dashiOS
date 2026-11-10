/**
 * The shell's side of Calendar (the app is apps/calendar): it reads the same
 * .ics files, fires the alerts as notifications, marks the days that have
 * events in the notification center's month, and opens Calendar on a day.
 * Started once from main.tsx.
 */

import { type App, launch } from "../apps.ts";
import { FIRST_PARTY, firstPartyApp } from "../first-party.ts";
import type { NotificationStore } from "../notifications/store.ts";
import type { Day } from "../shared/calendar/dates.ts";
import { openInRunning, socketPath } from "../shared/calendar/instance.ts";
import { defaultRoot } from "../shared/calendar/store.ts";
import type { ToplevelStore } from "../toplevels.ts";
import { setCalendarBridge } from "./bridge.ts";
import { CalendarFeed } from "./feed.ts";
import { APP_ID, Reminders } from "./reminders.ts";

export { calendarBridge, setCalendarBridge, useBusyDays } from "./bridge.ts";
export { CalendarFeed } from "./feed.ts";
export { Reminders } from "./reminders.ts";

export interface CalendarOptions {
  notifications: NotificationStore;
  toplevels: Pick<ToplevelStore, "getSnapshot" | "act">;
  /** The calendars folder; `DASHI_CALENDAR_DIR` or the data home by default. */
  root?: string;
  /** Starts the app; the real launcher by default. */
  launch?: (app: App) => number | null;
  /** The socket of a running Calendar. */
  socket?: string;
  /** Where the fired alerts are written down; null keeps them in memory. */
  statePath?: string | null;
}

export interface CalendarService {
  feed: CalendarFeed;
  /** Shows Calendar on `day`: the running one is told and brought forward, else it is started on it. */
  openDay(day: Day): Promise<void>;
  close(): void;
}

export function startCalendar(options: CalendarOptions): CalendarService {
  const feed = new CalendarFeed(options.root ?? defaultRoot());
  const run = options.launch ?? launch;
  const spec = FIRST_PARTY.find((each) => each.id === APP_ID);

  const openDay = async (day: Day): Promise<void> => {
    if (await openInRunning(day, options.socket ?? socketPath())) {
      const window = options.toplevels.getSnapshot().find((each) => each.appId === APP_ID);
      if (window) {
        if (window.minimized) options.toplevels.act(window.id, "unminimize");
        options.toplevels.act(window.id, "activate");
      }
      return;
    }
    if (!spec) return;
    const app = firstPartyApp(spec);
    run({ ...app, exec: [...(app.exec ?? []), "--day", day] });
  };

  const stopFeed = feed.start();
  const reminders = new Reminders({ feed, notifications: options.notifications, onOpen: (day) => void openDay(day), statePath: options.statePath });
  const stopReminders = reminders.start();
  setCalendarBridge({
    busyDays: (from, to) => feed.busyDays(from, to),
    subscribe: feed.subscribe,
    getVersion: feed.getVersion,
    openDay: (day) => void openDay(day),
  });
  return {
    feed,
    openDay,
    close() {
      setCalendarBridge(null);
      stopReminders();
      stopFeed();
    },
  };
}
