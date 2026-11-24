/**
 * The window's left side: the mini month and the calendars, or in a narrow
 * window only the calendars, as the rail (LA-5).
 */

import type { ClockPrefs } from "../../../../src/shared/time/index.ts";
import type { CalendarChrome } from "../chrome.ts";
import type { CalendarFiles } from "../hooks/use-calendar-files.ts";
import type { Overlays } from "../hooks/use-overlays.ts";
import type { CalendarModel } from "../model.ts";
import type { CalendarState } from "../state.ts";
import type { Target } from "../target.ts";
import { Sidebar } from "./sidebar.tsx";

export function SidebarPane({
  model,
  state,
  chrome,
  prefs,
  firstDay,
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
  destination: Target | null;
  choose: (calendarId: string) => void;
  files: CalendarFiles;
  overlays: Overlays;
}) {
  const { anchor, today, calendars, hidden } = state;
  const newCalendar = (): void => overlays.setSheet({ kind: "new-calendar" });
  return (
    <Sidebar
      rail={chrome.rail}
      anchor={anchor}
      today={today}
      firstDay={firstDay}
      prefs={prefs}
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
