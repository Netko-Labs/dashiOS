/**
 * Calendar's smaller sheets: a calendar's name and color, deleting one, and
 * the question a change to one time of a repeat asks: this event, this and
 * the following ones, or all of them. The file sheets are in file-sheets.tsx.
 */

import { AlertSheet, alertButtonsWidth, Button, ConfirmSheet, Sheet, TextField, useColors, WARNING } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { useState } from "react";
import type { EventInput } from "../../src/shared/calendar/event.ts";
import { isColor } from "../../src/shared/calendar/ics.ts";
import { PALETTE } from "../../src/shared/calendar/store.ts";
import type { Scope } from "./edits.ts";
import type { OccurrenceRef } from "./model.ts";

export type SheetState =
  | { kind: "new-calendar" }
  | { kind: "edit-calendar"; id: string; name: string; color: string }
  | { kind: "delete-calendar"; id: string; name: string; events: number }
  /** A change to one time of a repeat: which of its times it is for. */
  | {
      kind: "scope";
      action: "change" | "delete";
      ref: OccurrenceRef;
      title: string;
      /** change: what it becomes, the calendar it moves to, and the step's name. */
      input?: EventInput;
      moveTo?: string;
      name?: string;
      /** "This event" is offered (not when the repeat itself changed). */
      allowThis: boolean;
    }
  | { kind: "import-path"; reason: string }
  | { kind: "import-target"; text: string; name: string; fileName: string }
  | { kind: "export"; calendarId: string }
  | { kind: "problems" };

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

const CANCEL = "Cancel";
const THIS = "This event";
const FOLLOWING = "This and following";
const ALL = "All events";
/** The sheet's card: 20 either side of what it holds. */
const SHEET_PAD = 20;

/** The repeat question's width: 460, or wider so its buttons stay on one row. */
export function scopeSheetWidth(labels: readonly string[]): number {
  return Math.max(460, alertButtonsWidth(labels) + SHEET_PAD * 2);
}

/**
 * Which times of a repeat a change or a delete is for. "This event" is the
 * default (Return); Esc cancels. Deleting all of them is the ume button.
 */
export function ScopeSheet({
  action,
  title,
  allowThis,
  onChoose,
  onCancel,
}: {
  action: "change" | "delete";
  title: string;
  allowThis: boolean;
  onChoose: (scope: Scope) => void;
  onCancel: () => void;
}) {
  const name = title || "New Event";
  const deleting = action === "delete";
  const labels = [CANCEL, ...(allowThis ? [THIS] : []), FOLLOWING, ALL];
  return (
    <AlertSheet
      testID="scope"
      width={scopeSheetWidth(labels)}
      question={deleting ? `Delete “${name}”?` : `Change “${name}”?`}
      message={
        deleting
          ? "It repeats. Delete only this event, this one and the ones after it, or every time it happens? Edit › Undo brings them back."
          : allowThis
            ? "It repeats. Change only this event, this one and the ones after it, or every time it happens?"
            : "Its repeat changed, so the change is for this event and the ones after it, or for every time it happens."
      }
      glyph={WARNING}
      tone={deleting ? "danger" : "accent"}
      buttons={[
        { label: CANCEL, testID: "scope:cancel", onPress: onCancel, cancel: true },
        ...(allowThis ? [{ label: THIS, testID: "scope:this", onPress: () => onChoose("this"), isDefault: true }] : []),
        { label: FOLLOWING, testID: "scope:following", onPress: () => onChoose("following"), isDefault: !allowThis },
        { label: ALL, testID: "scope:all", onPress: () => onChoose("all"), ...(deleting ? { kind: "danger" as const } : {}) },
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
