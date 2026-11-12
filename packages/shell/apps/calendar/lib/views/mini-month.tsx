/** The small month in the sidebar: days to jump to, today filled, the days the view shows tinted, a dot under days with events. */

import { useColors, useSurface } from "@dashi/ui";
import { Svg, Text, View } from "@mirinjs/metal";
import { useEffect, useState } from "react";
import { addDays, addMonths, type Day, firstOfMonth, monthOf, startOfWeek } from "../../../../src/shared/calendar/index.ts";
import { type ClockPrefs, weekdayNames } from "../../../../src/shared/time/index.ts";
import { monthTitle } from "../format.ts";
import { CHEVRON_LEFT, CHEVRON_RIGHT } from "../glyphs.ts";
import { monthGrid } from "../layout.ts";

const CELL = 24;

export interface MiniMonthProps {
  /** The day the main view is on. */
  anchor: Day;
  today: Day;
  firstDay: number;
  prefs: ClockPrefs;
  /** The days the main view shows, tinted. */
  shown: ReadonlySet<Day>;
  busy: (from: Day, to: Day) => ReadonlySet<Day>;
  onPick: (day: Day) => void;
  /** Where its test ids start ("mini"; the event sheet's date picker has its own). */
  idPrefix?: string;
}

export function MiniMonth({ anchor, today, firstDay, prefs, shown, busy, onPick, idPrefix = "mini" }: MiniMonthProps) {
  const colors = useColors();
  const surface = useSurface();
  const [page, setPage] = useState<Day>(firstOfMonth(monthOf(anchor).year, monthOf(anchor).month));
  // The main view moved to another month: follow it.
  useEffect(() => {
    const { year, month } = monthOf(anchor);
    setPage(firstOfMonth(year, month));
  }, [anchor]);
  const { month } = monthOf(page);
  const weeks = monthGrid(page, firstDay);
  // Always six rows, so what is under the mini month does not move from month to month.
  while (weeks.length < 6) weeks.push(Array.from({ length: 7 }, (_, offset) => addDays((weeks[weeks.length - 1] as Day[])[6] as Day, offset + 1)));
  const first = startOfWeek(page, firstDay);
  const dots = busy(first, addDays(first, 42));
  const names = weekdayNames(prefs.locale, firstDay);

  const arrow = (markup: string, by: number, testID: string) => (
    <View
      testID={testID}
      onPress={() => setPage(addMonths(page, by))}
      style={{ width: 22, height: 22, borderRadius: 6, alignItems: "center", justifyContent: "center", hoverBackgroundColor: colors.button }}
    >
      <Svg markup={markup} size={11} color={colors.textMuted} />
    </View>
  );

  return (
    <View testID={`${idPrefix}-month`} style={{ flexDirection: "column", gap: 2, flexShrink: 0, marginBottom: idPrefix === "mini" ? 12 : 0 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", height: 24, paddingLeft: 6 }}>
        <Text style={{ fontSize: 12, fontWeight: "semibold", color: colors.text }}>{monthTitle(page, prefs)}</Text>
        <View style={{ flexDirection: "row", gap: 0 }}>
          {arrow(CHEVRON_LEFT, -1, `${idPrefix}-previous`)}
          {arrow(CHEVRON_RIGHT, 1, `${idPrefix}-next`)}
        </View>
      </View>
      <View style={{ flexDirection: "row" }}>
        {names.map((name) => (
          <View key={name} style={{ flex: 1, alignItems: "center" }}>
            <Text style={{ fontSize: 10, fontWeight: "semibold", color: colors.textMuted }}>{name.slice(0, 1).toUpperCase()}</Text>
          </View>
        ))}
      </View>
      {weeks.map((week) => (
        <View key={week[0]} style={{ flexDirection: "row", height: CELL }}>
          {week.map((day) => {
            const isToday = day === today;
            const inMonth = monthOf(day).month === month;
            const lit = shown.has(day);
            return (
              <View
                key={day}
                testID={`${idPrefix}:${day}`}
                onPress={() => onPick(day)}
                style={{
                  flex: 1,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: lit && !isToday ? colors.button : "#00000000",
                  borderRadius: 6,
                }}
              >
                <View
                  style={{
                    width: CELL - 2,
                    height: CELL - 2,
                    borderRadius: (CELL - 2) / 2,
                    alignItems: "center",
                    justifyContent: "center",
                    // Today is an ink mark, and a day with events a muted dot: green means "on".
                    backgroundColor: isToday ? colors.text : "#00000000",
                  }}
                >
                  <Text
                    style={{
                      fontSize: 11,
                      fontWeight: isToday ? "bold" : "normal",
                      color: isToday ? surface.window : inMonth ? colors.text : colors.textMuted,
                      opacity: inMonth || isToday ? 1 : 0.55,
                    }}
                  >
                    {String(Number(day.slice(8, 10)))}
                  </Text>
                  {dots.has(day) && (
                    <View
                      style={{
                        position: "absolute",
                        bottom: 1,
                        width: 3,
                        height: 3,
                        borderRadius: 2,
                        backgroundColor: isToday ? surface.window : colors.textMuted,
                      }}
                    />
                  )}
                </View>
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}
