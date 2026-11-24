/**
 * The event sheet's fields: a labelled row, a day (typed as the region writes
 * dates, stepped a day at a time, or picked from a small month under it), a
 * time (typed as people say it, stepped by 15 minutes), a stepper, and a time
 * zone (typed as a name or a city).
 */

import { CHEVRON_LEFT, CHEVRON_RIGHT, RADIUS, SPACE, TextField, ToolbarButton, TYPE, useColors } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { type ReactNode, useState } from "react";
import { addDays, type Day, hereZone, parseZone, zoneCity } from "../../../../src/shared/calendar/index.ts";
import { type ClockPrefs, usesHour24 } from "../../../../src/shared/time/index.ts";
import { clock, weekdayShort } from "../format.ts";
import { CALENDAR } from "../glyphs.ts";
import { dateOrder, formatDayText, parseDayText, parseTimeText } from "../timetext.ts";
import { MiniMonth } from "../views/mini-month.tsx";

/** A field's line: 28 tall, as a field and its arrows are; a row of pills or check boxes is 26. */
export const FIELD_LINE = 28;
export const PILL_LINE = 26;
/** The labels' column, right-aligned before the controls. */
const LABEL_WIDTH = 62;
/** The least a typed day, a typed time and a zone keep in a narrow sheet, and the weekday's words after a day. */
const DAY_LEAST = 96;
const TIME_LEAST = 72;
const ZONE_LEAST = 160;
const WEEKDAY_WIDTH = 30;
/** The date picker: the month grid (180 wide) 6 in from a 1 px edge. */
const PICKER = { width: 194, padding: SPACE.s, edge: 1 } as const;

/**
 * A labelled row of the sheet. One rule for every row: the label sits on the
 * middle of its control's first line, however many lines the control wraps
 * to (a row of `pills` has 26 tall lines, any other 28), and every control
 * starts at the top of its row.
 */
export function FormRow({ label, children, pills }: { label: string; children: ReactNode; pills?: boolean }) {
  const colors = useColors();
  const line = pills ? PILL_LINE : FIELD_LINE;
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: SPACE.inset }}>
      <View style={{ width: LABEL_WIDTH, height: line, flexShrink: 0, alignItems: "flex-end", justifyContent: "center" }}>
        <Text style={{ fontSize: TYPE.secondary.size, color: colors.textMuted }}>{label}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0, minHeight: line, flexDirection: "row", alignItems: "flex-start", gap: SPACE.s, flexWrap: "wrap" }}>{children}</View>
    </View>
  );
}

/** Words beside a control, on the middle of its 28 pt line. */
export function LineText({ children, width }: { children: string; width?: number }) {
  const colors = useColors();
  return (
    <View style={{ height: FIELD_LINE, justifyContent: "center", flexShrink: 0, ...(width !== undefined ? { width } : {}) }}>
      <Text numberOfLines={1} style={{ fontSize: TYPE.secondary.size, color: colors.textMuted }}>
        {children}
      </Text>
    </View>
  );
}

/** A step back or on, or the date picker: the kit's glyph button, its glyph drawn (IC-3), named by its tooltip. */
export function Arrow({ glyph, tooltip, onPress, testID }: { glyph: string; tooltip: string; onPress: () => void; testID: string }) {
  return <ToolbarButton testID={testID} glyph={glyph} tooltip={tooltip} onPress={() => onPress()} />;
}

/** A day field: typed as the region writes dates (or 2026-11-05), stepped a day at a time, or picked from a small month. */
export function DayInput({
  id,
  value,
  onChange,
  prefs,
  firstDay,
}: {
  id: string;
  value: Day;
  onChange: (day: Day) => void;
  prefs: ClockPrefs;
  firstDay: number;
}) {
  const colors = useColors();
  const [typed, setTyped] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const order = dateOrder(prefs.locale);
  const set = (day: Day): void => {
    setTyped(null);
    onChange(day);
  };
  return (
    // It grows with its row (the field takes the room), so the row ends on the sheet's one right edge.
    <View style={{ flexDirection: "column", gap: SPACE.s, flexGrow: 1 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.s }}>
        <View style={{ flexGrow: 1, minWidth: DAY_LEAST, flexDirection: "row" }}>
          <TextField
            testID={`${id}-day`}
            value={typed ?? formatDayText(value, prefs.locale)}
            onChangeText={(text) => {
              setTyped(text);
              const day = parseDayText(text, order, Number(value.slice(0, 4)));
              if (day !== null) onChange(day);
            }}
          />
        </View>
        <Arrow
          glyph={CALENDAR}
          tooltip={picking ? "Hide the month" : "Pick from a month"}
          testID={`${id}-day-pick`}
          onPress={() => setPicking((open) => !open)}
        />
        <Arrow glyph={CHEVRON_LEFT} tooltip="The day before" testID={`${id}-day-previous`} onPress={() => set(addDays(value, -1))} />
        <Arrow glyph={CHEVRON_RIGHT} tooltip="The day after" testID={`${id}-day-next`} onPress={() => set(addDays(value, 1))} />
        <LineText width={WEEKDAY_WIDTH}>{weekdayShort(value, prefs)}</LineText>
      </View>
      {picking && (
        <View style={{ width: PICKER.width, padding: PICKER.padding, borderRadius: RADIUS.control, borderWidth: PICKER.edge, borderColor: colors.separator }}>
          <MiniMonth
            idPrefix={`${id}-picker`}
            anchor={value}
            firstDay={firstDay}
            prefs={prefs}
            busy={() => new Set()}
            onPick={(day) => {
              set(day);
              setPicking(false);
            }}
          />
        </View>
      )}
    </View>
  );
}

/** A time field: "2:30 pm", "14:30", or a bare "3" (3 PM in a 12-hour region); the arrows step 15 minutes. */
export function TimeInput({ id, minutes, onChange, prefs }: { id: string; minutes: number; onChange: (minutes: number) => void; prefs: ClockPrefs }) {
  const [typed, setTyped] = useState<string | null>(null);
  const label = clock(`2000-01-01T${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`, prefs);
  const step = (by: number): void => {
    setTyped(null);
    onChange(Math.max(0, Math.min(1439, minutes + by)));
  };
  return (
    // Grows with its row, as the day does, so both rows end on one edge.
    <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.s, flexGrow: 1 }}>
      <View style={{ flexGrow: 1, minWidth: TIME_LEAST, flexDirection: "row" }}>
        <TextField
          testID={`${id}-time`}
          value={typed ?? label}
          onChangeText={(text) => {
            setTyped(text);
            const parsed = parseTimeText(text, !usesHour24(prefs));
            if (parsed !== null) onChange(parsed);
          }}
        />
      </View>
      <Arrow glyph={CHEVRON_LEFT} tooltip="15 minutes earlier" testID={`${id}-time-previous`} onPress={() => step(-15)} />
      <Arrow glyph={CHEVRON_RIGHT} tooltip="15 minutes later" testID={`${id}-time-next`} onPress={() => step(15)} />
    </View>
  );
}

export function Stepper({ id, value, min, max, onChange }: { id: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  const colors = useColors();
  return (
    <>
      <Arrow glyph={CHEVRON_LEFT} tooltip="One less" testID={`${id}-less`} onPress={() => onChange(Math.max(min, value - 1))} />
      <View style={{ minWidth: FIELD_LINE, height: FIELD_LINE, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ fontSize: TYPE.body.size, color: colors.text }}>{String(value)}</Text>
      </View>
      <Arrow glyph={CHEVRON_RIGHT} tooltip="One more" testID={`${id}-more`} onPress={() => onChange(Math.min(max, value + 1))} />
    </>
  );
}

/**
 * The zone a timed event keeps its clock in: empty is this computer's. Typed
 * as a name ("Europe/Lisbon") or a city ("Lisbon"); a zone not found says so.
 */
export function ZoneInput({ zone, onChange }: { zone: string | null; onChange: (zone: string | null) => void }) {
  const here = hereZone();
  const [typed, setTyped] = useState<string | null>(null);
  const shown = zone === null || zone === here ? "" : zone;
  const unknown = typed !== null && typed.trim() !== "" && parseZone(typed) === null;
  return (
    <View style={{ flexGrow: 1, minWidth: ZONE_LEAST, flexDirection: "row" }}>
      <TextField
        testID="event-zone"
        value={typed ?? shown}
        placeholder={`${zoneCity(here)} (this computer)`}
        {...(unknown ? { message: "No zone by that name", invalid: true } : {})}
        onChangeText={(text) => {
          setTyped(text);
          if (text.trim() === "") onChange(here);
          else {
            const found = parseZone(text);
            if (found) onChange(found);
          }
        }}
      />
    </View>
  );
}
