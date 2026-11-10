/**
 * The month: weeks of day cells, each listing its events as chips, with "N
 * more" when they do not all fit. A click picks a day and a double click
 * makes an event there, named in place; a chip dragged to another day moves
 * the event there (the days it would cover are washed in its color).
 */

import { useColors } from "@dashi/ui";
import { type Bounds, Text, View } from "@mirinjs/metal";
import { useState } from "react";
import { type Day, monthOf } from "../../../../src/shared/calendar/dates.ts";
import type { Occurrence } from "../../../../src/shared/calendar/types.ts";
import { type ClockPrefs, weekdayNames } from "../../../../src/shared/time/index.ts";
import { monthDayAt } from "../grid/drag.ts";
import type { GridHandlers, GridState } from "../grid/grid-props.ts";
import { CHIP_TIME_FROM, chipCapacity, monthGrid } from "../layout.ts";
import { DayCell, type MonthShared } from "./day-cell.tsx";

export interface MonthViewProps {
  anchor: Day;
  today: Day;
  firstDay: number;
  prefs: ClockPrefs;
  occurrences: readonly Occurrence[];
  colorOf: (calendarId: string) => string;
  state: GridState;
  handlers: GridHandlers;
}

export function MonthView({ anchor, today, firstDay, prefs, occurrences, colorOf, state, handlers }: MonthViewProps) {
  const colors = useColors();
  const weeks = monthGrid(anchor, firstDay);
  const { month } = monthOf(anchor);
  const [grid, setGrid] = useState<Bounds>({ x: 0, y: 0, width: 0, height: 494 });
  const capacity = chipCapacity(grid.height / weeks.length);
  const names = weekdayNames(prefs.locale, firstDay);
  // A narrow cell gives its chips' room to their titles: the time goes first.
  const timed = grid.width <= 0 || grid.width / 7 >= CHIP_TIME_FROM;
  const geometry = { days: weeks.flat(), columnWidth: grid.width / 7, dayAt: (x: number, y: number) => monthDayAt(grid, weeks, x, y) };

  const shared: MonthShared = { today, month, prefs, occurrences, colorOf, state, handlers, capacity, timed, weeks: weeks.length, geometry };

  return (
    <View testID="month-view" style={{ flex: 1, flexDirection: "column", minHeight: 0 }}>
      <View style={{ height: 26, flexShrink: 0, flexDirection: "row", borderBottomWidth: 1, borderColor: colors.separator }}>
        {names.map((name) => (
          <View key={name} style={{ flex: 1, alignItems: "flex-end", justifyContent: "center", paddingRight: 8 }}>
            <Text style={{ fontSize: 11, fontWeight: "semibold", color: colors.textMuted }}>{name}</Text>
          </View>
        ))}
      </View>
      <View style={{ flex: 1, flexDirection: "column", minHeight: 0 }} onLayout={setGrid}>
        {weeks.map((week, row) => (
          <View key={week[0]} style={{ flex: 1, flexDirection: "row", minHeight: 0 }}>
            {week.map((day, column) => (
              <DayCell key={day} day={day} row={row} column={column} shared={shared} />
            ))}
          </View>
        ))}
      </View>
    </View>
  );
}
