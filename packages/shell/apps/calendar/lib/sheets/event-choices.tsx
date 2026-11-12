/**
 * Parts of the event sheet that are more than a text box: the calendar to
 * put the event in (a pill for each), the alert choices, the notes, and the
 * buttons under the form.
 */

import { Button, useColors, useSurface } from "@dashi/ui";
import { Text, TextInput, View } from "@mirinjs/metal";
import type { Calendar } from "../../../../src/shared/calendar/index.ts";
import type { Draft } from "../draft.ts";
import { ALL_DAY_ALERTS, alertLabel, TIMED_ALERTS } from "../format.ts";
import { FormRow } from "./form-fields.tsx";

export function CalendarChoice({ calendars, chosenId, onChoose }: { calendars: readonly Calendar[]; chosenId: string; onChoose: (id: string) => void }) {
  const colors = useColors();
  return (
    <FormRow label="Calendar" pills>
      <View testID="event-calendar" focusGroup style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {calendars.map((calendar) => {
          const chosen = calendar.id === chosenId;
          return (
            <View
              key={calendar.id}
              testID={`event-calendar:${calendar.id}`}
              focusable
              accessibilityRole="option"
              onPress={() => onChoose(calendar.id)}
              style={{
                height: 26,
                flexShrink: 1,
                minWidth: 0,
                paddingHorizontal: 10,
                borderRadius: 13,
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                backgroundColor: chosen ? colors.selection : colors.button,
                focusRingColor: colors.focusRing,
              }}
            >
              <View
                style={{
                  width: 9,
                  height: 9,
                  flexShrink: 0,
                  borderRadius: 5,
                  backgroundColor: calendar.color,
                  borderWidth: chosen ? 1 : 0,
                  borderColor: "#ffffff",
                }}
              />
              <View style={{ flexShrink: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ fontSize: 12, color: chosen ? "#ffffff" : colors.text }}>
                  {calendar.name}
                </Text>
              </View>
            </View>
          );
        })}
      </View>
    </FormRow>
  );
}

export function NotesField({ value, onChange, onCancel }: { value: string; onChange: (notes: string) => void; onCancel: () => void }) {
  const colors = useColors();
  const surface = useSurface();
  return (
    <FormRow label="Notes">
      <TextInput
        testID="event-notes"
        multiline
        value={value}
        placeholder="Add notes"
        onChangeText={onChange}
        onKeyPress={(key) => key === "Escape" && onCancel()}
        style={{
          width: "100%",
          height: 64,
          padding: 6,
          fontSize: 13,
          borderRadius: 7,
          color: colors.text,
          placeholderColor: colors.textDisabled,
          backgroundColor: surface.card,
          borderColor: colors.separator,
          focusBorderColor: colors.focusRing,
        }}
      />
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
    <View style={{ flexDirection: "row", flexShrink: 0, gap: 8, marginTop: 2 }}>
      {editing && <Button label="Delete" testID="event-delete" danger onPress={onDelete} />}
      <View style={{ flex: 1 }} />
      <Button label="Cancel" testID="event-cancel" onPress={onCancel} />
      <Button label={editing ? "Save" : "Add"} testID="event-save" primary disabled={problem} onPress={onSave} />
    </View>
  );
}
