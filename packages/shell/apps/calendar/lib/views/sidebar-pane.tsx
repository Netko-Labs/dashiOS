/**
 * The window's left side: the mini month and the calendars, or in a narrow
 * window only the calendars as a rail of dots.
 */

import { useMemo } from "react";
import type { Day } from "../../../../src/shared/calendar/dates.ts";
import type { ClockPrefs } from "../../../../src/shared/time/clock.ts";
import type { CalendarChrome } from "../chrome.ts";
import type { CalendarFiles } from "../hooks/use-calendar-files.ts";
import type { Overlays } from "../hooks/use-overlays.ts";
import type { CalendarModel } from "../model.ts";
import type { CalendarState } from "../state.ts";
import type { Target } from "../target.ts";
import { CalendarRail, Sidebar } from "./sidebar.tsx";

export function SidebarPane({
  model,
  state,
  chrome,
  prefs,
  firstDay,
  days,
  destination,
  choose,
  files,
  overlays,
}: {
  model: CalendarModel;
  state: CalendarState;
  chrome: CalendarChrome;
  prefs: ClockPrefs;
  firstDay: number;
  days: readonly Day[];
  destination: Target | null;
  choose: (calendarId: string) => void;
  files: CalendarFiles;
  overlays: Overlays;
}) {
  const { view, anchor, today, calendars, hidden } = state;
  // The month view shows every day of the mini month, so only the week and day views tint what they show.
  const shown = useMemo(() => new Set(view === "month" ? [] : days), [days, view]);
  const newCalendar = (): void => overlays.setSheet({ kind: "new-calendar" });
  if (chrome.rail) {
    return (
      <CalendarRail
        calendars={calendars}
        hidden={hidden}
        onToggle={(id) => model.toggle(id)}
        onMenu={files.calendarMenu}
        onNewCalendar={newCalendar}
        onImport={files.importFile}
      />
    );
  }
  return (
    <Sidebar
      anchor={anchor}
      today={today}
      firstDay={firstDay}
      prefs={prefs}
      shown={shown}
      busy={(from, to) => model.busy(from, to)}
      onPick={(day) => {
        model.goTo(day);
        overlays.takeKeys();
      }}
      calendars={calendars}
      hidden={hidden}
      onToggle={(id) => model.toggle(id)}
      target={destination?.reveal === false ? destination.calendarId : null}
      onChoose={(id) => {
        // A hidden calendar picked as the one for new events shows again: they never go into a hidden one.
        if (!model.isVisible(id)) model.toggle(id);
        choose(id);
        overlays.takeKeys();
      }}
      onMenu={files.calendarMenu}
      onNewCalendar={newCalendar}
      onImport={files.importFile}
    />
  );
}
