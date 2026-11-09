/**
 * The full sheet for an event (the popover's Edit…, or Return on a picked
 * event): title, calendar, all day, start and end on the event's own clock,
 * its time zone, place, repeat, alert, notes. It opens on the time that was
 * clicked; saving a change to one time of a repeat asks which times it is for
 * (sheets.tsx). Changing the start takes the end along. Most events never
 * need it: they are drawn, named, moved, and stretched on the grid.
 */

import { Button, Choices, Sheet, Switch, TextField, useColors, useSurface } from "@dashi/ui";
import { ScrollView, Text, TextInput, View } from "@mirinjs/metal";
import { useState } from "react";
import type { ClockPrefs } from "../../src/clock.ts";
import { weekdayNames } from "../../src/region/week.ts";
import { type Draft, type EndsChoice, type MonthlyBy, moveStart, nthOf, problemWith, type RepeatChoice, setAllDay } from "./draft.ts";
import { DayField, FIELD_LINE, FormRow, LineText, Stepper, TimeField, ZoneField } from "./form-fields.tsx";
import { ALL_DAY_ALERTS, alertLabel, nthName, TIMED_ALERTS } from "./format.ts";
import type { Calendar } from "./types.ts";

export interface EventSheetProps {
  draft: Draft;
  calendars: readonly Calendar[];
  prefs: ClockPrefs;
  /** 0 Sunday … 6 Saturday: the region's first day, for the weekdays and the date picker. */
  firstDay?: number;
  /** The event exists already: the sheet says Save and offers Delete. */
  editing: { repeating: boolean; custom: boolean } | null;
  onSave: (draft: Draft) => void;
  onDelete: () => void;
  onCancel: () => void;
}

const REPEATS: ReadonlyArray<{ value: RepeatChoice; label: string }> = [
  { value: "none", label: "Never" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly" },
];
const ENDS: ReadonlyArray<{ value: EndsChoice; label: string }> = [
  { value: "never", label: "Never" },
  { value: "count", label: "After" },
  { value: "until", label: "On date" },
];
const UNITS = { daily: "day", weekly: "week", monthly: "month", yearly: "year" } as const;

export function EventSheet({ draft: initial, calendars, prefs, firstDay = 1, editing, onSave, onDelete, onCancel }: EventSheetProps) {
  const colors = useColors();
  const surface = useSurface();
  const [draft, setDraft] = useState(initial);
  const change = (patch: Partial<Draft>): void => setDraft((current) => ({ ...current, ...patch }));
  const problem = problemWith(draft);
  const save = (): void => {
    if (problem === null) onSave(draft);
  };
  const alerts = draft.allDay ? ALL_DAY_ALERTS : TIMED_ALERTS;
  const alertChoices = alerts.map(([value, label]) => ({ value: value === null ? "none" : String(value), label }));
  if (draft.alert !== null && !alerts.some(([value]) => value === draft.alert))
    alertChoices.push({ value: String(draft.alert), label: alertLabel(draft.alert, draft.allDay) });
  const repeatChoices = initial.repeat === "custom" ? [...REPEATS, { value: "custom" as RepeatChoice, label: "Custom" }] : REPEATS;
  const repeats = draft.repeat !== "none" && draft.repeat !== "custom";
  // The weekday buttons start on the region's first day and say its letters.
  const names = weekdayNames(prefs.locale, 0);
  const order = Array.from({ length: 7 }, (_, offset) => (firstDay + offset) % 7);
  const monthly: ReadonlyArray<{ value: MonthlyBy; label: string }> = [
    { value: "date", label: `On day ${Number(draft.startDay.slice(8, 10))}` },
    { value: "weekday", label: `On ${nthName(nthOf(draft.startDay), prefs)}` },
  ];
  const fields = { prefs, firstDay };

  return (
    <Sheet testID="event-sheet" width={520} onCancel={onCancel}>
      {/* The form scrolls, and gives way first in a short window; the problem and the buttons stay in reach. */}
      <ScrollView testID="event-form" style={{ flexShrink: 1, minHeight: 0, maxHeight: 540 }}>
        <View style={{ flexDirection: "column", gap: 10, paddingBottom: 2 }}>
          <FormRow label="Title">
            <TextField
              testID="event-title"
              value={draft.title}
              placeholder="New Event"
              autoFocus
              onChangeText={(title) => change({ title })}
              onSubmit={save}
              onKeyPress={(key) => key === "Escape" && onCancel()}
            />
          </FormRow>
          <FormRow label="Calendar" pills>
            <View testID="event-calendar" focusGroup style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {calendars.map((calendar) => {
                const chosen = calendar.id === draft.calendarId;
                return (
                  <View
                    key={calendar.id}
                    testID={`event-calendar:${calendar.id}`}
                    focusable
                    accessibilityRole="option"
                    onPress={() => change({ calendarId: calendar.id })}
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
          <FormRow label="All-day">
            <View style={{ height: FIELD_LINE, justifyContent: "center" }}>
              <Switch on={draft.allDay} testID="event-all-day" onChange={(allDay) => setDraft(setAllDay(draft, allDay))} />
            </View>
          </FormRow>
          <FormRow label="Starts">
            <DayField id="start" value={draft.startDay} {...fields} onChange={(day) => setDraft(moveStart(draft, day, draft.startMinutes))} />
            {!draft.allDay && (
              <TimeField id="start" minutes={draft.startMinutes} prefs={prefs} onChange={(minutes) => setDraft(moveStart(draft, draft.startDay, minutes))} />
            )}
          </FormRow>
          <FormRow label="Ends">
            <DayField id="end" value={draft.endDay} {...fields} onChange={(endDay) => change({ endDay })} />
            {!draft.allDay && <TimeField id="end" minutes={draft.endMinutes} prefs={prefs} onChange={(endMinutes) => change({ endMinutes })} />}
          </FormRow>
          {!draft.allDay && (
            <FormRow label="Time zone">
              <ZoneField zone={draft.zone} onChange={(zone) => change({ zone })} />
            </FormRow>
          )}
          <FormRow label="Location">
            <TextField
              testID="event-location"
              value={draft.location}
              placeholder="Add a place"
              onChangeText={(location) => change({ location })}
              onSubmit={save}
              onKeyPress={(key) => key === "Escape" && onCancel()}
            />
          </FormRow>
          <FormRow label="Repeat" pills>
            <Choices testID="event-repeat" options={repeatChoices} value={draft.repeat} onChange={(repeat) => change({ repeat })} />
          </FormRow>
          {repeats && (
            <>
              <FormRow label="Every">
                <Stepper id="event-every" value={draft.every} min={1} max={99} onChange={(every) => change({ every })} />
                <LineText>{`${UNITS[draft.repeat as keyof typeof UNITS]}${draft.every === 1 ? "" : "s"}`}</LineText>
              </FormRow>
              {draft.repeat === "weekly" && (
                <FormRow label="On" pills>
                  <View testID="event-weekdays" style={{ flexDirection: "row", gap: 4 }}>
                    {order.map((index) => {
                      const on = draft.weekdays.includes(index);
                      return (
                        <View
                          key={index}
                          testID={`event-weekday:${index}`}
                          focusable
                          accessibilityRole="checkbox"
                          accessibilityLabel={names[index]}
                          onPress={() => change({ weekdays: on ? draft.weekdays.filter((each) => each !== index) : [...draft.weekdays, index] })}
                          style={{
                            width: 26,
                            height: 26,
                            borderRadius: 13,
                            alignItems: "center",
                            justifyContent: "center",
                            backgroundColor: on ? colors.selection : colors.button,
                            focusRingColor: colors.focusRing,
                          }}
                        >
                          <Text style={{ fontSize: 11, fontWeight: "semibold", color: on ? "#ffffff" : colors.text }}>
                            {(names[index] ?? "").slice(0, 1).toUpperCase()}
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                </FormRow>
              )}
              {draft.repeat === "monthly" && (
                <FormRow label="On" pills>
                  <Choices testID="event-monthly" options={monthly} value={draft.monthlyBy} onChange={(monthlyBy) => change({ monthlyBy })} />
                </FormRow>
              )}
              <FormRow label="Ends" pills>
                <Choices testID="event-ends" options={ENDS} value={draft.ends} onChange={(ends) => change({ ends })} />
                {draft.ends === "count" && (
                  <>
                    <Stepper id="event-count" value={draft.count} min={1} max={999} onChange={(count) => change({ count })} />
                    <LineText>times</LineText>
                  </>
                )}
                {draft.ends === "until" && <DayField id="until" value={draft.until} {...fields} onChange={(until) => change({ until })} />}
              </FormRow>
            </>
          )}
          <FormRow label="Alert" pills>
            <Choices
              testID="event-alert"
              options={alertChoices}
              value={draft.alert === null ? "none" : String(draft.alert)}
              onChange={(value) => change({ alert: value === "none" ? null : Number(value) })}
            />
          </FormRow>
          <FormRow label="Notes">
            <TextInput
              testID="event-notes"
              multiline
              value={draft.notes}
              placeholder="Add notes"
              onChangeText={(notes) => change({ notes })}
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
                focusBorderColor: colors.selection,
              }}
            />
          </FormRow>
        </View>
      </ScrollView>
      {problem !== null && (
        <View testID="event-problem" style={{ flexShrink: 0 }}>
          <Text style={{ fontSize: 12, color: colors.ume }}>{problem}</Text>
        </View>
      )}
      <View style={{ flexDirection: "row", flexShrink: 0, gap: 8, marginTop: 2 }}>
        {editing !== null && <Button label="Delete" testID="event-delete" danger onPress={onDelete} />}
        <View style={{ flex: 1 }} />
        <Button label="Cancel" testID="event-cancel" onPress={onCancel} />
        <Button label={editing === null ? "Add" : "Save"} testID="event-save" primary disabled={problem !== null} onPress={save} />
      </View>
    </Sheet>
  );
}
