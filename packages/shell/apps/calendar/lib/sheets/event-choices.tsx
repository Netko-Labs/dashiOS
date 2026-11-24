/**
 * Parts of the event sheet that are more than a text box: the calendar to
 * put the event in (a pop-up button), the alert choices, the notes, and the
 * buttons under the form.
 */

import { Button, PopUpButton, SPACE, TextArea } from "@dashi/ui";
import { View } from "@mirinjs/metal";
import type { Calendar } from "../../../../src/shared/calendar/index.ts";
import type { Draft } from "../draft.ts";
import { ALL_DAY_ALERTS, alertLabel, TIMED_ALERTS } from "../format.ts";
import { FormRow } from "./form-fields.tsx";

/** The calendar to put the event in: a list of any length, so a pop-up button (UI-2). */
export function CalendarChoice({ calendars, chosenId, onChoose }: { calendars: readonly Calendar[]; chosenId: string; onChoose: (id: string) => void }) {
  return (
    <FormRow label="Calendar">
      <PopUpButton
        testID="event-calendar"
        options={calendars.map((calendar) => ({ value: calendar.id, label: calendar.name }))}
        value={chosenId}
        onChange={onChoose}
      />
    </FormRow>
  );
}

/** The notes' box: three lines of 13. */
const NOTES_HEIGHT = 64;

/** The notes: the kit's many-line field (TextArea) across the form's column. */
export function NotesRow({ value, onChange, onCancel }: { value: string; onChange: (notes: string) => void; onCancel: () => void }) {
  return (
    <FormRow label="Notes">
      <View style={{ width: "100%", flexDirection: "column" }}>
        <TextArea
          testID="event-notes"
          value={value}
          placeholder="Add notes"
          label="Notes"
          height={NOTES_HEIGHT}
          onChangeText={onChange}
          onKeyPress={(key) => key === "Escape" && onCancel()}
        />
      </View>
    </FormRow>
  );
}

/** The alert choices for the draft's kind of event; an alert it already has that is not offered stays in the list. */
export function alertChoicesFor(draft: Draft): Array<{ value: string; label: string }> {
  const alerts = draft.allDay ? ALL_DAY_ALERTS : TIMED_ALERTS;
  const choices = alerts.map(([value, label]) => ({ value: value === null ? "none" : String(value), label }));
  if (draft.alert !== null && !alerts.some(([value]) => value === draft.alert))
    choices.push({ value: String(draft.alert), label: alertLabel(draft.alert, draft.allDay) });
  return choices;
}

export function SheetButtons({
  editing,
  problem,
  onDelete,
  onCancel,
  onSave,
}: {
  editing: boolean;
  problem: boolean;
  onDelete: () => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <View style={{ flexDirection: "row", flexShrink: 0, gap: SPACE.m, marginTop: SPACE.xxs }}>
      {editing && <Button label="Delete" testID="event-delete" danger onPress={onDelete} />}
      <View style={{ flex: 1 }} />
      <Button label="Cancel" testID="event-cancel" onPress={onCancel} />
      <Button label={editing ? "Save" : "Add"} testID="event-save" primary disabled={problem} onPress={onSave} />
    </View>
  );
}
