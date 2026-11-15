/**
 * Calendar (dev.dashi.calendar): `bun apps/calendar/main.tsx [--day 2026-11-05]`.
 * The calendars are .ics files under ~/.local/share/dashi/calendars
 * (`DASHI_CALENDAR_DIR` moves them); this is the window on them. One Calendar
 * runs at a time: a second start tells the first and exits, and the first
 * shows the day it was given (the shell, from the notification center's month
 * or a reminder) or, given none (the Dock), stays as it is. The alerts are not
 * fired from here but by the shell (src/calendar/), so they come with this
 * window closed.
 */

import { CalendarStore, dayFromArgs, defaultRoot, listenForOpen, openInRunning, SIDECAR_FILE, watchCalendars } from "../../src/shared/calendar/index.ts";
import { runApp } from "../kit/index.ts";
import { CALENDAR_LEAST } from "./lib/chrome.ts";
import { portalIcsChooser } from "./lib/import.ts";
import { CalendarModel } from "./lib/model.ts";
import { CALENDAR_SIZE, CalendarWindow } from "./lib/views/view.tsx";

const day = dayFromArgs();

// Already open: show the day there (if one was asked for) and leave.
if (await openInRunning(day)) process.exit(0);

const model = new CalendarModel(new CalendarStore(defaultRoot()), () => new Date(), day ? { day, view: "day" } : undefined);

runApp(
  // The least size keeps every toolbar control and a week's seven columns readable (chrome.ts).
  { id: "dev.dashi.calendar", title: "Calendar", size: CALENDAR_SIZE, minSize: CALENDAR_LEAST },
  <CalendarWindow model={model} chooser={portalIcsChooser()} />,
);

// Only the sidecar changed (a calendar was hidden here or in the shell): no calendar is read again.
const onlySidecar = (names: ReadonlySet<string> | null): boolean =>
  names !== null && names.size > 0 && [...names].every((name) => name === SIDECAR_FILE || name.startsWith(`.${SIDECAR_FILE}.`));
const stopWatching = watchCalendars(model.store.root, (names) => (onlySidecar(names) ? model.reloadHidden() : model.reload()));
const stopListening = listenForOpen((requested) => {
  if (requested !== null) model.goTo(requested, "day");
});

const finish = (): void => {
  stopWatching();
  stopListening();
};
process.on("exit", finish);
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, () => process.exit(0));
