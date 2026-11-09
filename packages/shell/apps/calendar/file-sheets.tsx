/**
 * Calendar's sheets about files: the path of a file to import where there is
 * no file chooser, which calendar an import goes into, where File › Export…
 * writes a calendar, and the events that couldn't be shown.
 */

import { Button, PopUpButton, Sheet, TextField, useColors } from "@dashi/ui";
import { ScrollView, Text, View } from "@mirinjs/metal";
import { useState } from "react";
import type { Calendar } from "./types.ts";

/** The choice for a new calendar in the import sheet. */
export const NEW_CALENDAR = "";

/** Where there is no file chooser (a development run), the path of the file is typed. */
export function ImportPathSheet({ reason, onSubmit, onCancel }: { reason: string; onSubmit: (path: string) => void; onCancel: () => void }) {
  const colors = useColors();
  const [path, setPath] = useState("");
  const submit = (): void => {
    if (path.trim() !== "") onSubmit(path);
  };
  return (
    <Sheet testID="import-sheet" width={420}>
      <Text style={{ fontSize: 13, fontWeight: "bold", color: colors.text }}>Import a calendar</Text>
      <Text style={{ fontSize: 12, color: colors.textMuted }}>{reason}</Text>
      <TextField
        testID="import-path"
        value={path}
        placeholder="/home/alexk/Downloads/holidays.ics"
        autoFocus
        onChangeText={setPath}
        onSubmit={submit}
        onKeyPress={(key) => key === "Escape" && onCancel()}
      />
      <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
        <Button label="Cancel" testID="import-sheet:cancel" onPress={onCancel} />
        <Button label="Import" testID="import-sheet:ok" primary disabled={path.trim() === ""} onPress={submit} />
      </View>
    </Sheet>
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
    <Sheet testID="import-target" width={420} onCancel={onCancel} onConfirm={() => onImport(into === NEW_CALENDAR ? undefined : into)}>
      <Text style={{ fontSize: 13, fontWeight: "bold", color: colors.text }}>{`Import “${fileName}”`}</Text>
      <Text style={{ fontSize: 12, color: colors.textMuted }}>Events a calendar has already are left out.</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Text style={{ fontSize: 12, color: colors.textMuted }}>Into</Text>
        <PopUpButton testID="import-target:into" options={options} value={into} onChange={setInto} width={300} />
      </View>
      <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
        <Button label="Cancel" testID="import-target:cancel" onPress={onCancel} />
        <Button label="Import" testID="import-target:ok" primary onPress={() => onImport(into === NEW_CALENDAR ? undefined : into)} />
      </View>
    </Sheet>
  );
}

/** The Export sheet's width, and its column inside (less its 20 of padding and 1 of edge a side): the pop-up and the path end on one edge. */
const EXPORT_WIDTH = 440;
export const EXPORT_COLUMN = EXPORT_WIDTH - 2 * 21;

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
  const colors = useColors();
  const [calendarId, setCalendarId] = useState(initial);
  const nameOf = (id: string): string => calendars.find((calendar) => calendar.id === id)?.id ?? "Calendar";
  const [path, setPath] = useState(`${home}/${nameOf(initial)}.ics`);
  const submit = (): void => {
    if (path.trim() !== "") onExport(calendarId, path);
  };
  return (
    <Sheet testID="export-sheet" width={EXPORT_WIDTH}>
      <Text style={{ fontSize: 13, fontWeight: "bold", color: colors.text }}>Export a calendar</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
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
      </View>
      <TextField testID="export:path" value={path} autoFocus onChangeText={setPath} onSubmit={submit} onKeyPress={(key) => key === "Escape" && onCancel()} />
      <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
        <Button label="Cancel" testID="export:cancel" onPress={onCancel} />
        <Button label="Export" testID="export:ok" primary disabled={path.trim() === ""} onPress={submit} />
      </View>
    </Sheet>
  );
}

/** What couldn't be shown, one line each: kept in the files as written. */
export function ProblemsSheet({ problems, onClose }: { problems: readonly string[]; onClose: () => void }) {
  const colors = useColors();
  return (
    <Sheet testID="problems" width={480} onCancel={onClose} onConfirm={onClose}>
      <Text style={{ fontSize: 13, fontWeight: "bold", color: colors.text }}>
        {problems.length === 1 ? "1 event couldn't be shown" : `${problems.length} events couldn't be shown`}
      </Text>
      <Text style={{ fontSize: 12, color: colors.textMuted }}>They stay in their calendar files as they were written.</Text>
      <ScrollView style={{ maxHeight: 260 }}>
        <View style={{ flexDirection: "column", gap: 6 }}>
          {problems.map((problem, index) => (
            <Text key={String(index)} style={{ fontSize: 12, color: colors.text }}>
              {problem}
            </Text>
          ))}
        </View>
      </ScrollView>
      <View style={{ flexDirection: "row", justifyContent: "flex-end", marginTop: 4 }}>
        <Button label="Done" testID="problems:done" primary onPress={onClose} />
      </View>
    </Sheet>
  );
}
