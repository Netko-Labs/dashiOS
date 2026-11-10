/**
 * Calendar's window: the mini month and the calendars on the left; the
 * title, previous / Today / next, Day / Week / Month, Find and + in the
 * toolbar; and the view, which is the editor (use-grid.ts): draw on empty
 * time to make an event and name it in place, drag one to move it, drag its
 * foot to stretch it, press it for its popover. The full sheet is a click
 * further (Edit…). Keys no field takes come to the grid (window-keys.ts);
 * the ❖ chords come through the menus (menus.ts). An .ics file dropped on the
 * window is imported.
 *
 * This file is the layout. The window's jobs are hooks: use-calendar-data.ts
 * (what the model shows), use-overlays.ts, use-event-edits.ts,
 * use-calendar-files.ts, use-find.ts, use-notice.tsx and use-calendar-menus.ts;
 * its parts are toolbar.tsx, sidebar-pane.tsx, overlay.tsx and content.tsx.
 */

import { AppWindow } from "@dashi/ui";
import type { Bounds } from "@mirinjs/metal";
import { useState } from "react";
import { chromeFor } from "./chrome.ts";
import { CalendarContent } from "./content.tsx";
import type { IcsChooser } from "./import.ts";
import type { CalendarModel } from "./model.ts";
import { calendarOverlay } from "./overlay.tsx";
import { useRegionPrefs } from "./prefs.ts";
import { SidebarPane } from "./sidebar-pane.tsx";
import { CalendarToolbar, headingOf, ToolbarCenter } from "./toolbar.tsx";
import { useCalendarData, useNow } from "./use-calendar-data.ts";
import { useCalendarFiles } from "./use-calendar-files.ts";
import { useCalendarMenus } from "./use-calendar-menus.ts";
import { useEventEdits } from "./use-event-edits.ts";
import { useFind } from "./use-find.ts";
import { useGrid } from "./use-grid.ts";
import { useNotice } from "./use-notice.tsx";
import { useOverlays } from "./use-overlays.ts";

// Where the calendar's tests and other files looked for it.
export { TodayButton } from "./toolbar.tsx";

export const CALENDAR_SIZE = { width: 1120, height: 740 } as const;

export function CalendarWindow({ model, chooser, scroll }: { model: CalendarModel; chooser: IcsChooser; scroll: (testID: string, dy: number) => void }) {
  const { clock: prefs, firstDay } = useRegionPrefs();
  const [area, setArea] = useState<Bounds>({ x: 0, y: 0, width: CALENDAR_SIZE.width, height: CALENDAR_SIZE.height });
  // The content sits right of the sidebar, so together they are the window's width (Metal records no bounds for the root).
  const windowWidth = area.x + area.width;
  const chrome = chromeFor(windowWidth);
  const now = useNow(model);
  const overlays = useOverlays();
  const { state, occurrences, days, colorOf, destination, choose, undo } = useCalendarData(model, firstDay);
  const { notice, noteDeleted } = useNotice({ model, state, undo, showProblems: () => overlays.setSheet({ kind: "problems" }) });
  const grid = useGrid({
    model,
    state,
    occurrences,
    prefs,
    firstDay,
    destination,
    now: () => new Date(),
    openSheet: (occurrence) => edits.openSheet(occurrence),
    ask: (question) => edits.ask(question),
    deleted: noteDeleted,
    takeKeys: overlays.takeKeys,
  });
  const edits = useEventEdits({ model, overlays, grid, days, choose, noteDeleted });
  const files = useCalendarFiles({ model, chooser, overlays });
  const find = useFind({ model, state, grid, takeKeys: overlays.takeKeys });
  useCalendarMenus({ model, state, overlays, grid, find, files, undo, destination, openSheet: edits.openSheet });
  const heading = headingOf(state, days, prefs);

  return (
    <AppWindow
      title={heading.title}
      toolbar={<CalendarToolbar model={model} state={state} chrome={chrome} find={find} newEvent={grid.newEvent} />}
      overlay={calendarOverlay({ model, state, prefs, firstDay, area, windowWidth, colorOf, overlays, edits, files, find, grid })}
      notice={notice}
      center={<ToolbarCenter heading={heading} chrome={chrome} find={find} />}
      sidebarWidth={chrome.sidebarWidth}
      sidebar={
        <SidebarPane
          model={model}
          state={state}
          chrome={chrome}
          prefs={prefs}
          firstDay={firstDay}
          days={days}
          destination={destination}
          choose={choose}
          files={files}
          overlays={overlays}
        />
      }
    >
      <CalendarContent
        state={state}
        firstDay={firstDay}
        prefs={prefs}
        days={days}
        now={now}
        occurrences={occurrences}
        colorOf={colorOf}
        grid={grid}
        keys={overlays.keys}
        keysOpen={!overlays.modal && grid.popover === null && find.search === null && overlays.menu === null}
        onLayout={setArea}
        importPath={files.importPath}
        scroll={scroll}
      />
    </AppWindow>
  );
}
