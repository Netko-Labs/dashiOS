/**
 * Calendar's menus in the menu bar (the kit's `useAppMenus`): File (a new
 * event, named in place; a new calendar; import and export), Edit (Undo and
 * Redo of a change to an event, Delete, Find), Event (the picked event: Edit
 * Event…, Duplicate), and View (Day, Week, Month, Today, previous and next).
 * The shortcuts are real: Metal reports no ❖ chords to the app, but the shell
 * matches one against the focused app's enabled rows and chooses the item
 * (app-menus/shortcut.ts). While a sheet is open the rows are disabled, so a
 * chord does nothing behind it. Delete has no chord (❖⌫ is the shell's):
 * ⌫ on the grid deletes.
 */

import { type UndoState, undoMenuItems } from "@dashi/ui";
import type { MenuSpec } from "../../kit/index.ts";
import type { View } from "./layout.ts";

export interface MenuContext {
  view: View;
  /** A sheet is open. */
  modal: boolean;
  /** An event is picked. */
  picked: boolean;
  /** What Edit › Undo and Redo would take back. */
  undo: UndoState;
  actions: {
    newEvent(): void;
    newCalendar(): void;
    importFile(): void;
    exportFile(): void;
    setView(view: View): void;
    today(): void;
    step(direction: -1 | 1): void;
    undo(): void;
    redo(): void;
    deleteEvent(): void;
    editEvent(): void;
    duplicate(): void;
    find(): void;
  };
}

const LABELS: Record<View, string> = { day: "Day", week: "Week", month: "Month" };

export function calendarMenus(context: MenuContext): { menus: MenuSpec[]; run: (id: string) => void } {
  const { actions, modal, view, picked } = context;
  const free = !modal;
  const file: MenuSpec = {
    id: "file",
    items: [
      { id: "event:new", label: "New Event", shortcut: "❖N", enabled: free },
      { id: "calendar:new", label: "New Calendar…", shortcut: "⇧❖N", enabled: free },
      { type: "separator" },
      { id: "import", label: "Import…", enabled: free },
      { id: "export", label: "Export…", enabled: free },
    ],
  };
  const [undoRow, redoRow] = undoMenuItems(context.undo);
  const canUndo = undoRow.enabled && free;
  const canRedo = redoRow.enabled && free;
  const edit: MenuSpec = {
    id: "edit",
    items: [
      { ...undoRow, enabled: canUndo },
      { ...redoRow, enabled: canRedo },
      { type: "separator" },
      { id: "delete", label: "Delete", enabled: free && picked },
      { type: "separator" },
      { id: "find", label: "Find", shortcut: "❖F", enabled: free },
    ],
  };
  const event: MenuSpec = {
    id: "event",
    title: "Event",
    items: [
      { id: "event:edit", label: "Edit Event…", shortcut: "❖E", enabled: free && picked },
      { id: "event:duplicate", label: "Duplicate", shortcut: "❖D", enabled: free && picked },
    ],
  };
  const views: MenuSpec = {
    id: "view",
    items: [
      ...(["day", "week", "month"] as const).map((each, index) => ({
        id: `view:${each}`,
        label: LABELS[each],
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
  const enabled = new Set(
    [file, edit, event, views].flatMap((menu) =>
      menu.items.filter((item) => "id" in item && item.enabled !== false).map((item) => ("id" in item ? item.id : "")),
    ),
  );
  const run = (id: string): void => {
    // A chord the shell matched a moment before a sheet opened does nothing behind it.
    if (!enabled.has(id)) return;
    switch (id) {
      case "event:new":
        return actions.newEvent();
      case "calendar:new":
        return actions.newCalendar();
      case "import":
        return actions.importFile();
      case "export":
        return actions.exportFile();
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
      case "undo":
        return actions.undo();
      case "redo":
        return actions.redo();
      case "delete":
        return actions.deleteEvent();
      case "event:edit":
        return actions.editEvent();
      case "event:duplicate":
        return actions.duplicate();
      case "find":
        return actions.find();
    }
  };
  return { menus: [file, edit, event, views], run };
}
