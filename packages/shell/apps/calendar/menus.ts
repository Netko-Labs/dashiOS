/**
 * Calendar's menus in the menu bar (the kit's `useAppMenus`): File (new event,
 * new calendar, import) and View (Day, Week, Month, Today, previous and next).
 * The shortcuts are real: Metal reports no ❖ chords to the app, but the shell
 * matches one against the focused app's enabled rows and chooses the item
 * (app-menus/shortcut.ts). While a sheet is open the rows are disabled, so a
 * chord does nothing behind it.
 */

import type { MenuSpec } from "../kit/index.ts";
import type { View } from "./layout.ts";

export interface MenuContext {
  view: View;
  /** A sheet is open. */
  modal: boolean;
  actions: {
    newEvent(): void;
    newCalendar(): void;
    importFile(): void;
    setView(view: View): void;
    today(): void;
    step(direction: -1 | 1): void;
  };
}

const LABELS: Record<View, string> = { day: "Day", week: "Week", month: "Month" };

export function calendarMenus(context: MenuContext): { menus: MenuSpec[]; run: (id: string) => void } {
  const { actions, modal, view } = context;
  const free = !modal;
  const file: MenuSpec = {
    id: "file",
    items: [
      { id: "event:new", label: "New Event", shortcut: "❖N", enabled: free },
      { id: "calendar:new", label: "New Calendar…", shortcut: "⇧❖N", enabled: free },
      { type: "separator" },
      { id: "import", label: "Import…", enabled: free },
    ],
  };
  const views: MenuSpec = {
    id: "view",
    items: [
      ...(["day", "week", "month"] as const).map((each, index) => ({
        id: `view:${each}`,
        label: `by ${LABELS[each]}`,
        shortcut: `❖${index + 1}`,
        enabled: free,
        checked: view === each,
      })),
      { type: "separator" },
      { id: "today", label: "Go to Today", shortcut: "❖T", enabled: free },
      { id: "previous", label: `Previous ${LABELS[view]}`, shortcut: "❖[", enabled: free },
      { id: "next", label: `Next ${LABELS[view]}`, shortcut: "❖]", enabled: free },
    ],
  };
  const run = (id: string): void => {
    switch (id) {
      case "event:new":
        return actions.newEvent();
      case "calendar:new":
        return actions.newCalendar();
      case "import":
        return actions.importFile();
      case "view:day":
        return actions.setView("day");
      case "view:week":
        return actions.setView("week");
      case "view:month":
        return actions.setView("month");
      case "today":
        return actions.today();
      case "previous":
        return actions.step(-1);
      case "next":
        return actions.step(1);
    }
  };
  return { menus: [file, views], run };
}
