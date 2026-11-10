/**
 * Calendars and .ics files: a calendar's menu, importing a file (chosen,
 * typed or dropped) and exporting a calendar to a path.
 */

import { parseIcs } from "../../../../src/shared/calendar/ics.ts";
import { type Calendar, CalendarError } from "../../../../src/shared/calendar/types.ts";
import { type IcsChooser, readIcsFile, writeIcsFile } from "../import.ts";
import type { CalendarModel } from "../model.ts";
import type { Overlays } from "./use-overlays.ts";

export interface CalendarFiles {
  /** The menu for a calendar in the sidebar, at a point. */
  calendarMenu: (calendar: Calendar, x: number, y: number) => void;
  importPath: (path: string) => void;
  importFile: () => void;
  exportCalendar: (calendarId: string, path: string) => void;
}

export function useCalendarFiles({ model, chooser, overlays }: { model: CalendarModel; chooser: IcsChooser; overlays: Overlays }): CalendarFiles {
  const { sheet, setSheet, setMenu, closeOverlay } = overlays;

  const calendarMenu = (calendar: Calendar, x: number, y: number): void =>
    setMenu({
      x,
      y,
      items: [
        { label: "Edit Calendar…", onPress: () => setSheet({ kind: "edit-calendar", id: calendar.id, name: calendar.name, color: calendar.color }) },
        { label: "Export…", onPress: () => setSheet({ kind: "export", calendarId: calendar.id }) },
        {
          label: "Delete Calendar…",
          onPress: () => setSheet({ kind: "delete-calendar", id: calendar.id, name: calendar.name, events: calendar.events.length }),
        },
      ],
    });

  const importPath = (path: string): void => {
    try {
      const file = readIcsFile(path);
      const name = parseIcs(file.text).name ?? file.name;
      setSheet({ kind: "import-target", text: file.text, name, fileName: path.split("/").at(-1) ?? path });
    } catch (error) {
      if (!(error instanceof CalendarError)) throw error;
      // A file that is not a calendar is said so; a typed path's sheet stays for another try.
      if (sheet?.kind === "import-path") setSheet({ kind: "import-path", reason: error.message });
      model.fail(error.message);
    }
  };

  const importFile = (): void => {
    model.dismissMessages();
    chooser
      .choose()
      .then((path) => {
        if (path !== null) importPath(path);
      })
      .catch(() => setSheet({ kind: "import-path", reason: "There is no file chooser here. Type the path of the .ics file instead." }));
  };

  const exportCalendar = (calendarId: string, path: string): void => {
    try {
      const written = writeIcsFile(path, model.store.text(calendarId));
      model.say(`Exported “${model.calendar(calendarId)?.name ?? calendarId}” to ${written}.`);
      closeOverlay();
    } catch (error) {
      if (!(error instanceof CalendarError)) throw error;
      model.fail(error.message);
    }
  };

  return { calendarMenu, importPath, importFile, exportCalendar };
}
