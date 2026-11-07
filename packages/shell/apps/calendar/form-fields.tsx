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

export function FormRow({ label, children, top }: { label: string; children: ReactNode; top?: boolean }) {
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
        height: 26,
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
    <View style={{ flexDirection: "column", gap: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <TextField
          testID={`${id}-day`}
          width={104}
          value={typed ?? formatDayText(value, prefs.locale)}
          onChangeText={(text) => {
            setTyped(text);
            const day = parseDayText(text, order, Number(value.slice(0, 4)));
            if (day !== null) onChange(day);
          }}
        />
        <Arrow glyph={CALENDAR} testID={`${id}-day-pick`} onPress={() => setPicking((open) => !open)} />
        <Arrow glyph="‹" testID={`${id}-day-previous`} onPress={() => set(addDays(value, -1))} />
        <Arrow glyph="›" testID={`${id}-day-next`} onPress={() => set(addDays(value, 1))} />
        <View style={{ width: 30 }}>
          <Text style={{ fontSize: 12, color: colors.textMuted }}>{weekdayShort(value, prefs)}</Text>
        </View>
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
    <>
      <TextField
        testID={`${id}-time`}
        width={86}
        value={typed ?? label}
        onChangeText={(text) => {
          setTyped(text);
          const parsed = parseTimeText(text, !usesHour24(prefs));
          if (parsed !== null) onChange(parsed);
        }}
      />
      <Arrow glyph="‹" testID={`${id}-time-previous`} onPress={() => step(-15)} />
      <Arrow glyph="›" testID={`${id}-time-next`} onPress={() => step(15)} />
    </>
  );
}

export function Stepper({ id, value, min, max, onChange }: { id: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
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

/**
 * The zone a timed event keeps its clock in: empty is this computer's. Typed
 * as a name ("Europe/Lisbon") or a city ("Lisbon"); a zone not found says so.
 */
export function ZoneField({ zone, onChange }: { zone: string | null; onChange: (zone: string | null) => void }) {
  const colors = useColors();
  const here = hereZone();
  const [typed, setTyped] = useState<string | null>(null);
  const shown = zone === null || zone === here ? "" : zone;
  const unknown = typed !== null && typed.trim() !== "" && parseZone(typed) === null;
  return (
    <>
      <TextField
        testID="event-zone"
        width={190}
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
      {unknown && <Text style={{ fontSize: 11, color: colors.textMuted }}>No zone by that name</Text>}
    </>
  );
}
