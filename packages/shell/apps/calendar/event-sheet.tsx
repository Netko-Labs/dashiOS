/**
 * The full sheet for an event (the popover's Edit…, or Return on a picked
 * event): title, calendar, all day, start and end on the event's own clock,
 * its time zone, place, repeat, alert, notes. It opens on the time that was
 * clicked; saving a change to one time of a repeat asks which times it is for
 * (sheets.tsx). Changing the start takes the end along. Most events never
 * need it: they are drawn, named, moved, and stretched on the grid.
 */

import { Choices, Sheet, Switch, sheetBodyRoom, TextField, useColors, useTitleBarInset } from "@dashi/ui";
import { ScrollView, Text, View } from "@mirinjs/metal";
import { useState } from "react";
import type { Calendar } from "../../src/shared/calendar/types.ts";
import type { ClockPrefs } from "../../src/shared/time/clock.ts";
import { type Draft, moveStart, problemWith, type RepeatChoice, setAllDay } from "./draft.ts";
import { alertChoicesFor, CalendarChoice, NotesField, SheetButtons } from "./event-choices.tsx";
import { RepeatFields } from "./event-repeat.tsx";
import { DayField, FIELD_LINE, FormRow, TimeField, ZoneField } from "./form-fields.tsx";

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
  /** The window's height (0 before it is laid out): the form scrolls within what the window leaves. */
  windowHeight?: number;
}

/** The form's most, in a tall window. */
const FORM_MAX = 540;
/** Under the form: the buttons (28, 2 above) and the gap before them; the problem's line (16 and a gap) when there is one. */
const FOOTER = 10 + 2 + 28;
const PROBLEM = 10 + 16;

const REPEATS: ReadonlyArray<{ value: RepeatChoice; label: string }> = [
  { value: "none", label: "Never" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly" },
];

export function EventSheet({ draft: initial, calendars, prefs, firstDay = 1, editing, onSave, onDelete, onCancel, windowHeight = 0 }: EventSheetProps) {
  const colors = useColors();
  const inset = useTitleBarInset();
  const [draft, setDraft] = useState(initial);
  const change = (patch: Partial<Draft>): void => setDraft((current) => ({ ...current, ...patch }));
  const problem = problemWith(draft);
  const save = (): void => {
    if (problem === null) onSave(draft);
  };
  const repeatChoices = initial.repeat === "custom" ? [...REPEATS, { value: "custom" as RepeatChoice, label: "Custom" }] : REPEATS;
  const repeats = draft.repeat !== "none" && draft.repeat !== "custom";
  const fields = { prefs, firstDay };
  const formMax = windowHeight > 0 ? Math.min(FORM_MAX, sheetBodyRoom(windowHeight, inset.top, FOOTER + (problem !== null ? PROBLEM : 0))) : FORM_MAX;

  return (
    <Sheet testID="event-sheet" width={520} onCancel={onCancel}>
      {/* The form scrolls, and gives way first in a short window; the problem and the buttons stay in reach. */}
      <ScrollView testID="event-form" style={{ maxHeight: formMax }}>
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
          <CalendarChoice calendars={calendars} chosenId={draft.calendarId} onChoose={(calendarId) => change({ calendarId })} />
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
          {repeats && <RepeatFields draft={draft} prefs={prefs} firstDay={firstDay} change={change} />}
          <FormRow label="Alert" pills>
            <Choices
              testID="event-alert"
              options={alertChoicesFor(draft)}
              value={draft.alert === null ? "none" : String(draft.alert)}
              onChange={(value) => change({ alert: value === "none" ? null : Number(value) })}
            />
          </FormRow>
          <NotesField value={draft.notes} onChange={(notes) => change({ notes })} onCancel={onCancel} />
        </View>
      </ScrollView>
      {problem !== null && (
        <View testID="event-problem" style={{ flexShrink: 0 }}>
          <Text style={{ fontSize: 12, color: colors.ume }}>{problem}</Text>
        </View>
      )}
      <SheetButtons editing={editing !== null} problem={problem !== null} onDelete={onDelete} onCancel={onCancel} onSave={save} />
    </Sheet>
  );
}
