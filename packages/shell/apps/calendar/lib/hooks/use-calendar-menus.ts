/**
 * The window's menu bar menus (menus.ts) and what each command does here.
 */

import { useAppMenus } from "../../../kit/index.ts";
import { calendarMenus } from "../menus.ts";
import type { CalendarModel } from "../model.ts";
import type { CalendarState } from "../state.ts";
import type { Target } from "../target.ts";
import type { CalendarFiles } from "./use-calendar-files.ts";
import type { Find } from "./use-find.ts";
import type { Grid } from "./use-grid.ts";
import type { Overlays } from "./use-overlays.ts";

type Undo = Parameters<typeof calendarMenus>[0]["undo"];

export function useCalendarMenus({
  model,
  state,
  overlays,
  grid,
  find,
  files,
  undo,
  destination,
  openSheet,
}: {
  model: CalendarModel;
  state: CalendarState;
  overlays: Overlays;
  grid: Grid;
  find: Find;
  files: CalendarFiles;
  undo: Undo;
  destination: Target | null;
  openSheet: (occurrence: NonNullable<Grid["picked"]>) => void;
}): void {
  const { calendars, view } = state;
  // The lit calendar: the sidebar's menu acts on the row it opened on, the menu bar's on this one.
  const lit = calendars.find((each) => each.id === destination?.calendarId) ?? null;
  const { menus, run } = calendarMenus({
    view,
    modal: overlays.modal,
    picked: grid.picked !== null,
    calendar: lit ? { visible: model.isVisible(lit.id) } : null,
    undo,
    actions: {
      newEvent: grid.newEvent,
      newCalendar: () => overlays.setSheet({ kind: "new-calendar" }),
      editCalendar: () => lit && overlays.setSheet({ kind: "edit-calendar", id: lit.id, name: lit.name, color: lit.color }),
      toggleCalendar: () => lit && model.toggle(lit.id),
      deleteCalendar: () => lit && overlays.setSheet({ kind: "delete-calendar", id: lit.id, name: lit.name, events: lit.events.length }),
      importFile: files.importFile,
      exportFile: () => {
        const first = destination?.calendarId ?? calendars[0]?.id;
        if (first) overlays.setSheet({ kind: "export", calendarId: first });
      },
      setView: (next) => model.setView(next),
      today: () => model.goToday(),
      step: (direction) => model.step(direction),
      undo: () => void model.undoStep("undo"),
      redo: () => void model.undoStep("redo"),
      deleteEvent: () => grid.picked && grid.deleteOccurrence(grid.picked),
      editEvent: () => grid.picked && openSheet(grid.picked),
      duplicate: () => {
        if (!grid.picked) return;
        const copy = model.duplicate(grid.picked);
        if (copy) model.say(`Duplicated “${copy.title}”.`);
      },
      find: find.open,
    },
  });
  useAppMenus(menus, run);
}
