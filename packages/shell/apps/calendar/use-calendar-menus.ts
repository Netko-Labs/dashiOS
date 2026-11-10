/**
 * The window's menu bar menus (menus.ts) and what each command does here.
 */

import { useAppMenus } from "../kit/index.ts";
import { calendarMenus } from "./menus.ts";
import type { CalendarModel, CalendarState } from "./model.ts";
import type { Target } from "./target.ts";
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
  const { menus, run } = calendarMenus({
    view,
    modal: overlays.modal,
    picked: grid.picked !== null,
    undo,
    actions: {
      newEvent: grid.newEvent,
      newCalendar: () => overlays.setSheet({ kind: "new-calendar" }),
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
