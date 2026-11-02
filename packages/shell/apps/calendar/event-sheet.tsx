/**
 * The sheet that makes and edits an event: title, calendar, all day, start and
 * end, place, repeat, alert, notes. Days and times are typed (2026-11-05,
 * 2:30 pm) or stepped with the arrows; Metal has no date picker. Changing the
 * start takes the end along, as the Mac's does.
 */

import { Button, Choices, Sheet, TextField, useColors, useSurface } from "@dashi/ui";
import { ScrollView, Text, TextInput, View } from "@mirinjs/metal";
import { type ReactNode, useState } from "react";
import type { ClockPrefs } from "../../src/clock.ts";
import { Switch } from "../../src/wifi/switch.tsx";
import { addDays, type Day } from "./dates.ts";
import { type Draft, type EndsChoice, moveStart, problemWith, type RepeatChoice, setAllDay } from "./draft.ts";
import { ALL_DAY_ALERTS, alertLabel, clock, TIMED_ALERTS, weekdayShort } from "./format.ts";
import { parseDayText, parseTimeText } from "./timetext.ts";
import type { Calendar } from "./types.ts";

export interface EventSheetProps {
  draft: Draft;
  calendars: readonly Calendar[];
  prefs: ClockPrefs;
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
const LETTERS = ["S", "M", "T", "W", "T", "F", "S"];

function FormRow({ label, children, top }: { label: string; children: ReactNode; top?: boolean }) {
  const colors = useColors();
  return (
    <View style={{ flexDirection: "row", alignItems: top ? "flex-start" : "center", gap: 12, minHeight: 28 }}>
      <View style={{ width: 62, flexShrink: 0, alignItems: "flex-end", paddingTop: top ? 6 : 0 }}>
        <Text style={{ fontSize: 12, color: colors.textMuted }}>{label}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>{children}</View>
    </View>
  );
}

function Arrow({ glyph, onPress, testID }: { glyph: "‹" | "›"; onPress: () => void; testID: string }) {
  const colors = useColors();
  return (
    <View
      testID={testID}
      onPress={onPress}
      style={{
        width: 22,
        height: 26,
        borderRadius: 6,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: colors.button,
        hoverBackgroundColor: colors.separator,
      }}
    >
      <Text style={{ fontSize: 14, color: colors.text }}>{glyph}</Text>
    </View>
  );
}

/** A day field: typed, or stepped a day at a time; the weekday is written after it. */
function DayField({ id, value, onChange, prefs }: { id: string; value: Day; onChange: (day: Day) => void; prefs: ClockPrefs }) {
  const colors = useColors();
  const [typed, setTyped] = useState<string | null>(null);
  return (
    <>
      <TextField
        testID={`${id}-day`}
        width={100}
        value={typed ?? value}
        onChangeText={(text) => {
          setTyped(text);
          const day = parseDayText(text);
          if (day !== null) onChange(day);
        }}
      />
      <Arrow
        glyph="‹"
        testID={`${id}-day-previous`}
        onPress={() => {
          setTyped(null);
          onChange(addDays(value, -1));
        }}
      />
      <Arrow
        glyph="›"
        testID={`${id}-day-next`}
        onPress={() => {
          setTyped(null);
          onChange(addDays(value, 1));
        }}
      />
      <View style={{ width: 30 }}>
        <Text style={{ fontSize: 12, color: colors.textMuted }}>{weekdayShort(value, prefs)}</Text>
      </View>
    </>
  );
}

function TimeField({ id, minutes, onChange, prefs }: { id: string; minutes: number; onChange: (minutes: number) => void; prefs: ClockPrefs }) {
  const [typed, setTyped] = useState<string | null>(null);
  const label = clock(`2000-01-01T${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`, prefs);
  const step = (by: number): void => {
    setTyped(null);
    onChange(Math.max(0, Math.min(1439, minutes + by)));
  };
  return (
    <>
      <TextField
        testID={`${id}-time`}
        width={86}
        value={typed ?? label}
        onChangeText={(text) => {
          setTyped(text);
          const parsed = parseTimeText(text);
          if (parsed !== null) onChange(parsed);
        }}
      />
      <Arrow glyph="‹" testID={`${id}-time-previous`} onPress={() => step(-15)} />
      <Arrow glyph="›" testID={`${id}-time-next`} onPress={() => step(15)} />
    </>
  );
}

function Stepper({ id, value, min, max, onChange }: { id: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  const colors = useColors();
  return (
    <>
      <Arrow glyph="‹" testID={`${id}-less`} onPress={() => onChange(Math.max(min, value - 1))} />
      <View style={{ minWidth: 28, alignItems: "center" }}>
        <Text style={{ fontSize: 13, color: colors.text }}>{String(value)}</Text>
      </View>
      <Arrow glyph="›" testID={`${id}-more`} onPress={() => onChange(Math.min(max, value + 1))} />
    </>
  );
}

export function EventSheet({ draft: initial, calendars, prefs, editing, onSave, onDelete, onCancel }: EventSheetProps) {
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
  const repeatChoices = editing?.custom ? [...REPEATS, { value: "custom" as RepeatChoice, label: "Custom (kept)" }] : REPEATS;
  const repeats = draft.repeat !== "none" && draft.repeat !== "custom";

  return (
    <Sheet testID="event-sheet" width={500} onCancel={onCancel}>
      <ScrollView testID="event-form" style={{ maxHeight: 540 }}>
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
          <FormRow label="Calendar">
            <View testID="event-calendar" style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {calendars.map((calendar) => {
                const chosen = calendar.id === draft.calendarId;
                return (
                  <View
                    key={calendar.id}
                    testID={`event-calendar:${calendar.id}`}
                    onPress={() => change({ calendarId: calendar.id })}
                    style={{
                      height: 26,
                      paddingHorizontal: 10,
                      borderRadius: 13,
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 6,
                      backgroundColor: chosen ? colors.selection : colors.button,
                    }}
                  >
                    <View
                      style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: calendar.color, borderWidth: chosen ? 1 : 0, borderColor: "#ffffff" }}
                    />
                    <Text style={{ fontSize: 12, color: chosen ? "#ffffff" : colors.text }}>{calendar.name}</Text>
                  </View>
                );
              })}
            </View>
          </FormRow>
          <FormRow label="All-day">
            <Switch on={draft.allDay} testID="event-all-day" onChange={(allDay) => setDraft(setAllDay(draft, allDay))} />
          </FormRow>
          <FormRow label="Starts">
            <DayField id="start" value={draft.startDay} prefs={prefs} onChange={(day) => setDraft(moveStart(draft, day, draft.startMinutes))} />
            {!draft.allDay && (
              <TimeField id="start" minutes={draft.startMinutes} prefs={prefs} onChange={(minutes) => setDraft(moveStart(draft, draft.startDay, minutes))} />
            )}
          </FormRow>
          <FormRow label="Ends">
            <DayField id="end" value={draft.endDay} prefs={prefs} onChange={(endDay) => change({ endDay })} />
            {!draft.allDay && <TimeField id="end" minutes={draft.endMinutes} prefs={prefs} onChange={(endMinutes) => change({ endMinutes })} />}
          </FormRow>
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
          <FormRow label="Repeat" top>
            <Choices testID="event-repeat" options={repeatChoices} value={draft.repeat} onChange={(repeat) => change({ repeat })} />
          </FormRow>
          {repeats && (
            <>
              <FormRow label="Every">
                <Stepper id="event-every" value={draft.every} min={1} max={99} onChange={(every) => change({ every })} />
                <Text style={{ fontSize: 12, color: colors.textMuted }}>{`${UNITS[draft.repeat as keyof typeof UNITS]}${draft.every === 1 ? "" : "s"}`}</Text>
              </FormRow>
              {draft.repeat === "weekly" && (
                <FormRow label="On">
                  <View testID="event-weekdays" style={{ flexDirection: "row", gap: 4 }}>
                    {LETTERS.map((letter, index) => {
                      const on = draft.weekdays.includes(index);
                      return (
                        <View
                          key={index}
                          testID={`event-weekday:${index}`}
                          onPress={() => change({ weekdays: on ? draft.weekdays.filter((each) => each !== index) : [...draft.weekdays, index] })}
                          style={{
                            width: 26,
                            height: 26,
                            borderRadius: 13,
                            alignItems: "center",
                            justifyContent: "center",
                            backgroundColor: on ? colors.selection : colors.button,
                          }}
                        >
                          <Text style={{ fontSize: 11, fontWeight: "semibold", color: on ? "#ffffff" : colors.text }}>{letter}</Text>
                        </View>
                      );
                    })}
                  </View>
                </FormRow>
              )}
              <FormRow label="Ends">
                <Choices testID="event-ends" options={ENDS} value={draft.ends} onChange={(ends) => change({ ends })} />
                {draft.ends === "count" && (
                  <>
                    <Stepper id="event-count" value={draft.count} min={1} max={999} onChange={(count) => change({ count })} />
                    <Text style={{ fontSize: 12, color: colors.textMuted }}>times</Text>
                  </>
                )}
                {draft.ends === "until" && <DayField id="until" value={draft.until} prefs={prefs} onChange={(until) => change({ until })} />}
              </FormRow>
            </>
          )}
          <FormRow label="Alert" top>
            <Choices
              testID="event-alert"
              options={alertChoices}
              value={draft.alert === null ? "none" : String(draft.alert)}
              onChange={(value) => change({ alert: value === "none" ? null : Number(value) })}
            />
          </FormRow>
          <FormRow label="Notes" top>
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
      {editing?.repeating === true && (
        <Text style={{ fontSize: 11, color: colors.textMuted }}>This event repeats: changes apply to every time it happens.</Text>
      )}
      {problem !== null && (
        <View testID="event-problem">
          <Text style={{ fontSize: 12, color: colors.critical }}>{problem}</Text>
        </View>
      )}
      <View style={{ flexDirection: "row", gap: 8, marginTop: 2 }}>
        {editing !== null && <Button label="Delete" testID="event-delete" danger onPress={onDelete} />}
        <View style={{ flex: 1 }} />
        <Button label="Cancel" testID="event-cancel" onPress={onCancel} />
        <Button label={editing === null ? "Add" : "Save"} testID="event-save" primary disabled={problem !== null} onPress={save} />
      </View>
    </Sheet>
  );
}
