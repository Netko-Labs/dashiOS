/**
 * Calendar's sheets about files: the path of a file to import where there is
 * no file chooser, which calendar an import goes into, where File › Export…
 * writes a calendar, and the events that couldn't be shown.
 */

import { AlertSheet, FormSheet, PopUpButton, SPACE, TextField, TYPE, useColors, WARNING } from "@dashi/ui";
import { ScrollView, Text, View } from "@mirinjs/metal";
import { useState } from "react";
import type { Calendar } from "../../../../src/shared/calendar/index.ts";

/** The choice for a new calendar in the import sheet. */
export const NEW_CALENDAR = "";

/** The sheets' widths: a path to type, the import's target, the problems' list and its most height. */
const IMPORT_WIDTH = 420;
const INTO_WIDTH = 300;
const PROBLEMS = { width: 480, listHeight: 260 } as const;

/** Where there is no file chooser (a development run), the path of the file is typed. */
export function ImportPathSheet({ reason, onSubmit, onCancel }: { reason: string; onSubmit: (path: string) => void; onCancel: () => void }) {
  const colors = useColors();
  const [path, setPath] = useState("");
  const submit = (): void => {
    if (path.trim() !== "") onSubmit(path);
  };
  return (
    <FormSheet
      testID="import-sheet"
      title="Import a calendar"
      width={IMPORT_WIDTH}
      keys={false}
      buttons={[
        { label: "Cancel", testID: "import-sheet:cancel", onPress: onCancel, cancel: true },
        { label: "Import", testID: "import-sheet:ok", kind: "primary", disabled: path.trim() === "", onPress: submit },
      ]}
    >
      <Text style={{ fontSize: TYPE.secondary.size, color: colors.textMuted }}>{reason}</Text>
      <TextField
        testID="import-path"
        value={path}
        placeholder="/home/alexk/Downloads/holidays.ics"
        autoFocus
        onChangeText={setPath}
        onSubmit={submit}
        onKeyPress={(key) => key === "Escape" && onCancel()}
      />
    </FormSheet>
  );
}

/** Which calendar a file's events go into: a new one named after the file, or one there is (the events it has already are left out). */
export function ImportTargetSheet({
  fileName,
  name,
  calendars,
  onImport,
  onCancel,
}: {
  fileName: string;
  /** What a new calendar would be called. */
  name: string;
  calendars: readonly Calendar[];
  onImport: (into: string | undefined) => void;
  onCancel: () => void;
}) {
  const colors = useColors();
  // Into the calendar of the same name when there is one, so importing again doesn't make "Holidays 2".
  const same = calendars.find((calendar) => calendar.name.toLowerCase() === name.toLowerCase());
  const [into, setInto] = useState<string>(same?.id ?? NEW_CALENDAR);
  const options = [{ value: NEW_CALENDAR, label: `New calendar “${name}”` }, ...calendars.map((calendar) => ({ value: calendar.id, label: calendar.name }))];
  return (
    <FormSheet
      testID="import-target"
      title={`Import “${fileName}”`}
      width={IMPORT_WIDTH}
      buttons={[
        { label: "Cancel", testID: "import-target:cancel", onPress: onCancel, cancel: true },
        { label: "Import", testID: "import-target:ok", kind: "primary", onPress: () => onImport(into === NEW_CALENDAR ? undefined : into) },
      ]}
    >
      <Text style={{ fontSize: TYPE.secondary.size, color: colors.textMuted }}>Events a calendar has already are left out.</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.gap }}>
        <Text style={{ fontSize: TYPE.secondary.size, color: colors.textMuted }}>Into</Text>
        <PopUpButton testID="import-target:into" options={options} value={into} onChange={setInto} width={INTO_WIDTH} />
      </View>
    </FormSheet>
  );
}

/** The Export sheet's width, and its column inside (less its padding and 1 of edge a side): the pop-up and the path end on one edge. */
const EXPORT_WIDTH = 440;
export const EXPORT_COLUMN = EXPORT_WIDTH - 2 * (SPACE.sheet + 1);

/** File › Export…: a calendar written as an .ics file where the person says. */
export function ExportSheet({
  calendars,
  initial,
  home,
  onExport,
  onCancel,
}: {
  calendars: readonly Calendar[];
  initial: string;
  home: string;
  onExport: (calendarId: string, path: string) => void;
  onCancel: () => void;
}) {
  const [calendarId, setCalendarId] = useState(initial);
  const nameOf = (id: string): string => calendars.find((calendar) => calendar.id === id)?.id ?? "Calendar";
  const [path, setPath] = useState(`${home}/${nameOf(initial)}.ics`);
  const submit = (): void => {
    if (path.trim() !== "") onExport(calendarId, path);
  };
  return (
    <FormSheet
      testID="export-sheet"
      title="Export a calendar"
      width={EXPORT_WIDTH}
      keys={false}
      buttons={[
        { label: "Cancel", testID: "export:cancel", onPress: onCancel, cancel: true },
        { label: "Export", testID: "export:ok", kind: "primary", disabled: path.trim() === "", onPress: submit },
      ]}
    >
      <PopUpButton
        testID="export:calendar"
        options={calendars.map((calendar) => ({ value: calendar.id, label: calendar.name }))}
        value={calendarId}
        onChange={(id) => {
          // The file name follows the calendar while it is still the one made for the last.
          if (path === `${home}/${nameOf(calendarId)}.ics`) setPath(`${home}/${nameOf(id)}.ics`);
          setCalendarId(id);
        }}
        width={EXPORT_COLUMN}
      />
      <TextField testID="export:path" value={path} autoFocus onChangeText={setPath} onSubmit={submit} onKeyPress={(key) => key === "Escape" && onCancel()} />
    </FormSheet>
  );
}

/** What couldn't be shown, one line each: kept in the files as written. It only informs, so it is the alert frame with Done (UI-5). */
export function ProblemsSheet({ problems, onClose }: { problems: readonly string[]; onClose: () => void }) {
  const colors = useColors();
  return (
    <AlertSheet
      testID="problems"
      width={PROBLEMS.width}
      glyph={WARNING}
      tone="warning"
      question={problems.length === 1 ? "1 event couldn’t be shown" : `${problems.length} events couldn’t be shown`}
      message="They stay in their calendar files as they were written."
      buttons={[{ label: "Done", testID: "problems:done", kind: "primary", onPress: onClose, cancel: true }]}
    >
      <ScrollView style={{ maxHeight: PROBLEMS.listHeight }}>
        <View style={{ flexDirection: "column", gap: SPACE.s }}>
          {problems.map((problem, index) => (
            <Text key={String(index)} style={{ fontSize: TYPE.secondary.size, color: colors.text }}>
              {problem}
            </Text>
          ))}
        </View>
      </ScrollView>
    </AlertSheet>
  );
}
