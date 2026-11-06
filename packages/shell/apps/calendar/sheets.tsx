/** Calendar's smaller sheets: a calendar's name and color, the questions that can't be taken back, and the path of a file to import. */

import { AlertSheet, Button, ConfirmSheet, Sheet, TextField, useColors, WARNING } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { useState } from "react";
import { isColor } from "./ics.ts";
import { PALETTE } from "./store.ts";

export type SheetState =
  | { kind: "event" }
  | { kind: "new-calendar" }
  | { kind: "edit-calendar"; id: string; name: string; color: string }
  | { kind: "delete-calendar"; id: string; name: string; events: number }
  | { kind: "delete-event"; calendarId: string; uid: string; title: string; start: string; repeating: boolean }
  | { kind: "import-path"; reason: string };

export function CalendarSheet({
  title,
  initialName,
  initialColor,
  confirmLabel,
  onSubmit,
  onCancel,
}: {
  title: string;
  initialName: string;
  initialColor: string;
  confirmLabel: string;
  onSubmit: (name: string, color: string) => void;
  onCancel: () => void;
}) {
  const colors = useColors();
  const [name, setName] = useState(initialName);
  const [color, setColor] = useState(initialColor);
  const submit = (): void => {
    if (name.trim() !== "") onSubmit(name, color);
  };
  return (
    <Sheet testID="calendar-sheet" width={340}>
      <Text style={{ fontSize: 13, fontWeight: "bold", color: colors.text }}>{title}</Text>
      <TextField
        testID="calendar-name"
        value={name}
        placeholder="Name"
        autoFocus
        onChangeText={setName}
        onSubmit={submit}
        onKeyPress={(key) => key === "Escape" && onCancel()}
      />
      <View testID="calendar-colors" style={{ flexDirection: "row", gap: 8, paddingVertical: 2 }}>
        {PALETTE.map((each) => (
          <View
            key={each}
            testID={`calendar-color:${each}`}
            onPress={() => setColor(each)}
            style={{
              width: 24,
              height: 24,
              borderRadius: 12,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: each,
              borderWidth: color.toLowerCase() === each ? 2 : 0,
              borderColor: colors.text,
            }}
          />
        ))}
      </View>
      <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
        <Button label="Cancel" testID="calendar-sheet:cancel" onPress={onCancel} />
        <Button label={confirmLabel} testID="calendar-sheet:ok" primary disabled={name.trim() === "" || !isColor(color)} onPress={submit} />
      </View>
    </Sheet>
  );
}

/** Delete an event; a repeating one asks whether it is this time or all of them. */
export function DeleteEventSheet({
  sheet,
  onThis,
  onAll,
  onCancel,
}: {
  sheet: Extract<SheetState, { kind: "delete-event" }>;
  onThis: () => void;
  onAll: () => void;
  onCancel: () => void;
}) {
  if (!sheet.repeating) {
    return (
      <ConfirmSheet
        testID="delete-event"
        title={`Delete “${sheet.title || "New Event"}”?`}
        message="Edit › Undo brings it back."
        confirmLabel="Delete"
        danger
        onConfirm={onAll}
        onCancel={onCancel}
      />
    );
  }
  return (
    <AlertSheet
      testID="delete-event"
      width={420}
      question={`Delete “${sheet.title || "New Event"}”?`}
      message="This event repeats. Delete only this time, or every time it happens?"
      glyph={WARNING}
      tone="danger"
      buttons={[
        // Deleting is a click: Enter cancels, as Esc does.
        { label: "Cancel", testID: "delete-event:cancel", onPress: onCancel, cancel: true, isDefault: true },
        { label: "Delete This Time", testID: "delete-event:this", onPress: onThis },
        { label: "Delete All", testID: "delete-event:ok", onPress: onAll, kind: "danger" },
      ]}
    />
  );
}

export function DeleteCalendarSheet({
  sheet,
  onConfirm,
  onCancel,
}: {
  sheet: Extract<SheetState, { kind: "delete-calendar" }>;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <ConfirmSheet
      testID="delete-calendar"
      title={`Delete the calendar “${sheet.name}”?`}
      message={sheet.events === 0 ? "It has no events." : `Its ${sheet.events === 1 ? "event is" : `${sheet.events} events are`} deleted with it, for good.`}
      confirmLabel="Delete"
      danger
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}

/** Where there is no file chooser (a development run), the path of the file is typed. */
export function ImportPathSheet({ reason, onSubmit, onCancel }: { reason: string; onSubmit: (path: string) => void; onCancel: () => void }) {
  const colors = useColors();
  const [path, setPath] = useState("");
  const submit = (): void => {
    if (path.trim() !== "") onSubmit(path);
  };
  return (
    <Sheet testID="import-sheet" width={420}>
      <Text style={{ fontSize: 13, fontWeight: "bold", color: colors.text }}>Import Calendar</Text>
      <Text style={{ fontSize: 12, color: colors.textMuted }}>{reason}</Text>
      <TextField
        testID="import-path"
        value={path}
        placeholder="/home/you/Downloads/holidays.ics"
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
