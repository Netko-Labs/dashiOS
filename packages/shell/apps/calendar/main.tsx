/**
 * Calendar (dev.dashi.calendar): `bun apps/calendar/main.tsx [--day 2026-11-05]`.
 * The calendars are .ics files under ~/.local/share/dashi/calendars
 * (`DASHI_CALENDAR_DIR` moves them); this is the window on them. One Calendar
 * runs at a time: a second start (or the shell, from the notification
 * center's month) tells the first to show a day and exits. The alerts are not
 * fired from here but by the shell (src/calendar/), so they come with this
 * window closed.
 */

import { runApp } from "../kit/index.ts";
import { dayFromArgs, listenForOpen, openInRunning } from "./instance.ts";
import { portalIcsChooser } from "./import.ts";
import { CalendarModel } from "./model.ts";
import { CalendarStore, defaultRoot } from "./store.ts";
import { CALENDAR_SIZE, CalendarWindow } from "./view.tsx";
import { watchCalendars } from "./watch.ts";

const day = dayFromArgs();

// Already open: show the day there and leave.
if (await openInRunning(day ?? new Date().toISOString().slice(0, 10))) process.exit(0);

const model = new CalendarModel(new CalendarStore(defaultRoot()), () => new Date(), day ? { day, view: "day" } : undefined);

// The view scrolls its hours through the app once the window exists.
const handle: { scroll: (testID: string, dy: number) => void } = { scroll: () => {} };

const app = runApp(
  { id: "dev.dashi.calendar", title: "Calendar", size: CALENDAR_SIZE },
  <CalendarWindow model={model} chooser={portalIcsChooser()} scroll={(testID, dy) => handle.scroll(testID, dy)} />,
);
handle.scroll = (testID, dy) => {
  const id = app.root.nodeId(testID);
  if (id) app.host.simulate({ kind: "scroll", id, dy });
};

const stopWatching = watchCalendars(model.store.root, () => model.reload());
const stopListening = listenForOpen((requested) => model.goTo(requested, "day"));

const finish = (): void => {
  stopWatching();
  stopListening();
};
process.on("exit", finish);
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, () => process.exit(0));
