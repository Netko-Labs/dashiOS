/** The month: weeks of day cells, each listing its events as chips, with "N more" when they do not all fit. */

import { Text, View } from "@mirinjs/metal";
import { useState } from "react";
import type { ClockPrefs } from "../../src/clock.ts";
import { weekdayNames } from "../../src/region/week.ts";
import { useColors, useSurface } from "@dashi/ui";
import { EventChip, MoreChip } from "./chips.tsx";
import { type Day, monthOf } from "./dates.ts";
import { dayNumber, monthDay } from "./format.ts";
import { chipCapacity, fitChips, monthGrid, onDay } from "./layout.ts";
import type { Occurrence } from "./types.ts";

export interface MonthViewProps {
  anchor: Day;
  today: Day;
  firstDay: number;
  prefs: ClockPrefs;
  occurrences: readonly Occurrence[];
  colorOf: (calendarId: string) => string;
  /** A click on an empty part of a day. */
  onNew: (day: Day) => void;
  onOpen: (occurrence: Occurrence) => void;
  /** A click on a day's number or its "N more": that day on its own. */
  onDay: (day: Day) => void;
}

export function MonthView({ anchor, today, firstDay, prefs, occurrences, colorOf, onNew, onOpen, onDay: openDay }: MonthViewProps) {
  const colors = useColors();
  const surface = useSurface();
  const weeks = monthGrid(anchor, firstDay);
  const { month } = monthOf(anchor);
  const [gridHeight, setGridHeight] = useState(494);
  const capacity = chipCapacity(gridHeight / weeks.length);
  const names = weekdayNames(prefs.locale, firstDay);

  return (
    <View testID="month-view" style={{ flex: 1, flexDirection: "column", minHeight: 0 }}>
      <View style={{ height: 26, flexShrink: 0, flexDirection: "row", borderBottomWidth: 1, borderColor: colors.separator }}>
        {names.map((name) => (
          <View key={name} style={{ flex: 1, alignItems: "flex-end", justifyContent: "center", paddingRight: 8 }}>
            <Text style={{ fontSize: 11, fontWeight: "semibold", color: colors.textMuted }}>{name}</Text>
          </View>
        ))}
      </View>
      <View style={{ flex: 1, flexDirection: "column", minHeight: 0 }} onLayout={(bounds) => setGridHeight(bounds.height)}>
        {weeks.map((week, row) => (
          <View key={week[0]} style={{ flex: 1, flexDirection: "row", minHeight: 0 }}>
            {week.map((day, column) => {
              const here = onDay(occurrences, day);
              const { shown, more } = fitChips(here, capacity);
              const isToday = day === today;
              const inMonth = monthOf(day).month === month;
              return (
                <View
                  key={day}
                  testID={`day:${day}`}
                  onPress={() => onNew(day)}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    minHeight: 0,
                    flexDirection: "column",
                    gap: 1,
                    padding: 3,
                    borderRightWidth: column === 6 ? 0 : 1,
                    borderBottomWidth: row === weeks.length - 1 ? 0 : 1,
                    borderColor: colors.separator,
                    backgroundColor: inMonth ? "#00000000" : surface.field,
                    overflow: "hidden",
                  }}
                >
                  <View style={{ height: 20, flexShrink: 0, flexDirection: "row", justifyContent: "flex-end" }}>
                    <View
                      testID={`day-number:${day}`}
                      onPress={() => openDay(day)}
                      style={{ minWidth: 20, height: 20, paddingHorizontal: 4, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: isToday ? colors.selection : "#00000000", hoverBackgroundColor: isToday ? colors.selection : colors.button }}
                    >
                      <Text style={{ fontSize: 12, fontWeight: isToday ? "bold" : "normal", color: isToday ? "#ffffff" : inMonth ? colors.text : colors.textMuted }}>
                        {day.endsWith("-01") ? monthDay(day, prefs) : dayNumber(day)}
                      </Text>
                    </View>
                  </View>
                  {shown.map((occurrence) => (
                    <EventChip key={`${occurrence.calendarId}:${occurrence.event.uid}:${occurrence.start}`} occurrence={occurrence} color={colorOf(occurrence.calendarId)} day={day} prefs={prefs} onOpen={onOpen} />
                  ))}
                  {more > 0 && <MoreChip testID={`more:${day}`} count={more} onPress={() => openDay(day)} />}
                </View>
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
}
