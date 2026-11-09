/**
 * The event sheet's fields: a labelled row, a day (typed as the region writes
 * dates, stepped a day at a time, or picked from a small month under it), a
 * time (typed as people say it, stepped by 15 minutes), a stepper, and a time
 * zone (typed as a name or a city).
 */

import { TextField, useColors } from "@dashi/ui";
import { Svg, Text, View } from "@mirinjs/metal";
import { type ReactNode, useState } from "react";
import { type ClockPrefs, usesHour24 } from "../../src/clock.ts";
import { addDays, type Day } from "./dates.ts";
import { clock, weekdayShort } from "./format.ts";
import { CALENDAR } from "./glyphs.ts";
import { MiniMonth } from "./mini-month.tsx";
import { dateOrder, formatDayText, parseDayText, parseTimeText } from "./timetext.ts";
import { hereZone, parseZone, zoneCity } from "./zones.ts";

/** A field's line: 28 tall, as a field and its arrows are; a row of pills is 26. */
export const FIELD_LINE = 28;
export const PILL_LINE = 26;

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
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
      <View style={{ width: 62, height: line, flexShrink: 0, alignItems: "flex-end", justifyContent: "center" }}>
        <Text style={{ fontSize: 12, color: colors.textMuted }}>{label}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0, minHeight: line, flexDirection: "row", alignItems: "flex-start", gap: 6, flexWrap: "wrap" }}>{children}</View>
    </View>
  );
}

/** Words beside a control, on the middle of its 28 pt line. */
export function LineText({ children, width }: { children: string; width?: number }) {
  const colors = useColors();
  return (
    <View style={{ height: FIELD_LINE, justifyContent: "center", flexShrink: 0, ...(width !== undefined ? { width } : {}) }}>
      <Text numberOfLines={1} style={{ fontSize: 12, color: colors.textMuted }}>
        {children}
      </Text>
    </View>
  );
}

export function Arrow({ glyph, onPress, testID }: { glyph: string; onPress: () => void; testID: string }) {
  const colors = useColors();
  const isText = glyph.length <= 2;
  return (
    <View
      testID={testID}
      focusable
      accessibilityRole="button"
      onPress={onPress}
      style={{
        width: 22,
        height: FIELD_LINE,
        flexShrink: 0,
        borderRadius: 6,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: colors.button,
        hoverBackgroundColor: colors.separator,
        focusRingColor: colors.focusRing,
      }}
    >
      {isText ? <Text style={{ fontSize: 14, color: colors.text }}>{glyph}</Text> : <Svg markup={glyph} size={13} color={colors.textMuted} />}
    </View>
  );
}

/** A day field: typed as the region writes dates (or 2026-11-05), stepped a day at a time, or picked from a small month. */
export function DayField({
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
    <View style={{ flexDirection: "column", gap: 6, flexGrow: 1 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <View style={{ flexGrow: 1, minWidth: 104, flexDirection: "row" }}>
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
        <Arrow glyph={CALENDAR} testID={`${id}-day-pick`} onPress={() => setPicking((open) => !open)} />
        <Arrow glyph="‹" testID={`${id}-day-previous`} onPress={() => set(addDays(value, -1))} />
        <Arrow glyph="›" testID={`${id}-day-next`} onPress={() => set(addDays(value, 1))} />
        <LineText width={30}>{weekdayShort(value, prefs)}</LineText>
      </View>
      {picking && (
        <View style={{ width: 210, padding: 6, borderRadius: 8, borderWidth: 1, borderColor: colors.separator }}>
          <MiniMonth
            idPrefix={`${id}-picker`}
            anchor={value}
            today={value}
            firstDay={firstDay}
            prefs={prefs}
            shown={new Set([value])}
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
export function TimeField({ id, minutes, onChange, prefs }: { id: string; minutes: number; onChange: (minutes: number) => void; prefs: ClockPrefs }) {
  const [typed, setTyped] = useState<string | null>(null);
  const label = clock(`2000-01-01T${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`, prefs);
  const step = (by: number): void => {
    setTyped(null);
    onChange(Math.max(0, Math.min(1439, minutes + by)));
  };
  return (
    // Grows with its row, as the day does, so both rows end on one edge.
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexGrow: 1 }}>
      <View style={{ flexGrow: 1, minWidth: 86, flexDirection: "row" }}>
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
      <Arrow glyph="‹" testID={`${id}-time-previous`} onPress={() => step(-15)} />
      <Arrow glyph="›" testID={`${id}-time-next`} onPress={() => step(15)} />
    </View>
  );
}

export function Stepper({ id, value, min, max, onChange }: { id: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  const colors = useColors();
  return (
    <>
      <Arrow glyph="‹" testID={`${id}-less`} onPress={() => onChange(Math.max(min, value - 1))} />
      <View style={{ minWidth: 28, height: FIELD_LINE, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ fontSize: 13, color: colors.text }}>{String(value)}</Text>
      </View>
      <Arrow glyph="›" testID={`${id}-more`} onPress={() => onChange(Math.min(max, value + 1))} />
    </>
  );
}

/**
 * The zone a timed event keeps its clock in: empty is this computer's. Typed
 * as a name ("Europe/Lisbon") or a city ("Lisbon"); a zone not found says so.
 */
export function ZoneField({ zone, onChange }: { zone: string | null; onChange: (zone: string | null) => void }) {
  const here = hereZone();
  const [typed, setTyped] = useState<string | null>(null);
  const shown = zone === null || zone === here ? "" : zone;
  const unknown = typed !== null && typed.trim() !== "" && parseZone(typed) === null;
  return (
    <>
      <View style={{ flexGrow: 1, minWidth: 160, flexDirection: "row" }}>
        <TextField
          testID="event-zone"
          value={typed ?? shown}
          placeholder={`${zoneCity(here)} (this computer)`}
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
      {unknown && <LineText>No zone by that name</LineText>}
    </>
  );
}
