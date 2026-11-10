/**
 * What floats over the calendar, the most urgent first: the full event
 * sheet, a sheet, a calendar's menu, Find's answers, and the picked event's
 * popover.
 */

import { PopupMenu } from "@dashi/ui";
import type { Bounds } from "@mirinjs/metal";
import type { ReactElement } from "react";
import type { ClockPrefs } from "../../../../src/shared/time/clock.ts";
import { asksScope } from "../grid/grid-edits.ts";
import type { CalendarFiles } from "../hooks/use-calendar-files.ts";
import type { EventEdits } from "../hooks/use-event-edits.ts";
import type { Find } from "../hooks/use-find.ts";
import type { Grid } from "../hooks/use-grid.ts";
import type { Overlays } from "../hooks/use-overlays.ts";
import type { CalendarModel } from "../model.ts";
import { EventSheet } from "../sheets/event-sheet.tsx";
import { SheetLayer } from "../sheets/sheet-layer.tsx";
import type { CalendarState } from "../state.ts";
import { choosableCalendars } from "../target.ts";
import { EventPopover } from "./popover.tsx";
import { resultsPlace, SearchResults } from "./search-results.tsx";

export interface OverlayProps {
  model: CalendarModel;
  state: CalendarState;
  prefs: ClockPrefs;
  firstDay: number;
  area: Bounds;
  windowWidth: number;
  colorOf: (calendarId: string) => string;
  overlays: Overlays;
  edits: EventEdits;
  files: CalendarFiles;
  find: Find;
  grid: Grid;
}

/** The one thing floating over the calendar now, or undefined: an overlay element is only made while one is open. */
export function calendarOverlay({
  model,
  state,
  prefs,
  firstDay,
  area,
  windowWidth,
  colorOf,
  overlays,
  edits,
  files,
  find,
  grid,
}: OverlayProps): ReactElement | undefined {
  const { editing, sheet, menu, closeOverlay } = overlays;
  const { calendars, hidden } = state;
  const { search } = find;
  if (editing) {
    return (
      <EventSheet
        draft={editing.draft}
        calendars={choosableCalendars(calendars, hidden, editing.draft.calendarId)}
        prefs={prefs}
        firstDay={firstDay}
        editing={editing.occurrence === null ? null : { repeating: asksScope(editing.occurrence), custom: editing.draft.repeat === "custom" }}
        onSave={edits.saveSheet}
        onDelete={edits.deleteFromSheet}
        onCancel={closeOverlay}
        windowHeight={area.y + area.height}
      />
    );
  }
  if (sheet) {
    return (
      <SheetLayer
        sheet={sheet}
        model={model}
        calendars={calendars}
        problems={state.problems}
        onClose={closeOverlay}
        onScope={edits.answerScope}
        onImportPath={files.importPath}
        onExport={files.exportCalendar}
      />
    );
  }
  if (menu) return <PopupMenu testID="menu" x={menu.x} y={menu.y} items={menu.items} onClose={closeOverlay} />;
  if (search) {
    return (
      <SearchResults
        results={find.results}
        query={search.query}
        active={search.active}
        prefs={prefs}
        colorOf={colorOf}
        place={resultsPlace(find.findAt, windowWidth)}
        onPick={find.pickResult}
      />
    );
  }
  if (grid.popover) {
    return (
      <EventPopover
        occurrence={grid.popover.occurrence}
        calendar={model.calendar(grid.popover.occurrence.calendarId)}
        anchor={grid.popover.bounds ?? { x: area.x + area.width / 2 - 135, y: area.y + 40, width: 0, height: 0 }}
        area={area}
        prefs={prefs}
        onEdit={() => grid.popover && edits.openSheet(grid.popover.occurrence)}
        onDelete={() => grid.popover && grid.deleteOccurrence(grid.popover.occurrence)}
        onClose={grid.closePopover}
      />
    );
  }
  return undefined;
}
