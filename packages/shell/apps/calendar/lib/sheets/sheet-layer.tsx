/** Which of Calendar's smaller sheets is open (sheets.tsx, file-sheets.tsx), and what its answers do. */

import { type Calendar, paletteColor } from "../../../../src/shared/calendar/index.ts";
import type { Scope } from "../edits.ts";
import type { CalendarModel } from "../model.ts";
import { ExportSheet, ImportPathSheet, ImportTargetSheet, ProblemsSheet } from "./file-sheets.tsx";
import { CalendarSheet, DeleteCalendarSheet, ScopeSheet, type SheetState } from "./sheets.tsx";

export function SheetLayer({
  sheet,
  model,
  calendars,
  problems,
  onClose,
  onScope,
  onImportPath,
  onExport,
}: {
  sheet: SheetState;
  model: CalendarModel;
  calendars: readonly Calendar[];
  problems: readonly string[];
  onClose: () => void;
  onScope: (question: Extract<SheetState, { kind: "scope" }>, scope: Scope) => void;
  onImportPath: (path: string) => void;
  onExport: (calendarId: string, path: string) => void;
}) {
  const done = (run: () => void) => () => {
    run();
    onClose();
  };
  switch (sheet.kind) {
    case "scope":
      return (
        <ScopeSheet action={sheet.action} title={sheet.title} allowThis={sheet.allowThis} onChoose={(scope) => onScope(sheet, scope)} onCancel={onClose} />
      );
    case "new-calendar":
      return (
        <CalendarSheet
          title="New Calendar"
          initialName=""
          initialColor={paletteColor(calendars.length)}
          confirmLabel="Create"
          onCancel={onClose}
          onSubmit={(name, color) => done(() => model.createCalendar(name, color))()}
        />
      );
    case "edit-calendar":
      return (
        <CalendarSheet
          title="Edit Calendar"
          initialName={sheet.name}
          initialColor={sheet.color}
          confirmLabel="Save"
          onCancel={onClose}
          onSubmit={(name, color) =>
            done(() => {
              if (name.trim() !== sheet.name) model.renameCalendar(sheet.id, name);
              if (color !== sheet.color) model.recolorCalendar(sheet.id, color);
            })()
          }
        />
      );
    case "delete-calendar":
      return <DeleteCalendarSheet sheet={sheet} onCancel={onClose} onConfirm={done(() => model.removeCalendar(sheet.id))} />;
    case "import-path":
      return <ImportPathSheet reason={sheet.reason} onCancel={onClose} onSubmit={onImportPath} />;
    case "import-target":
      return (
        <ImportTargetSheet
          fileName={sheet.fileName}
          name={sheet.name}
          calendars={calendars}
          onCancel={onClose}
          onImport={(into) => done(() => model.importText(sheet.text, sheet.name, into))()}
        />
      );
    case "export":
      return <ExportSheet calendars={calendars} initial={sheet.calendarId} home={process.env.HOME ?? "/"} onExport={onExport} onCancel={onClose} />;
    case "problems":
      return <ProblemsSheet problems={problems} onClose={onClose} />;
  }
}
