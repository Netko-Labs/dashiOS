/**
 * The month: weeks of day cells, each listing its events as chips, with "N
 * more" when they do not all fit. A click picks a day and a double click
 * makes an event there, named in place; a chip dragged to another day moves
 * the event there (the days it would cover are washed in its color).
 */

import { TRUE_BLACK, useColors, useDark, useSurface } from "@dashi/ui";
import { type Bounds, Text, View } from "@mirinjs/metal";
import { useState } from "react";
import { addMinutes, type Day, dayPart, monthOf } from "../../src/shared/calendar/dates.ts";
import type { Occurrence } from "../../src/shared/calendar/types.ts";
import type { ClockPrefs } from "../../src/shared/time/clock.ts";
import { weekdayNames } from "../../src/shared/time/clock.ts";
import { EventChip, MoreChip } from "./chips.tsx";
import { tint } from "./colors.ts";
import { monthDayAt } from "./drag.ts";
import { occurrenceKey } from "./event-block.tsx";
import { dayNumber, monthDay } from "./format.ts";
import type { GridHandlers, GridState } from "./grid-props.ts";
import { InlineTitle } from "./inline-title.tsx";
import { CHIP_TIME_FROM, chipCapacity, fitChips, MONTH_CHIP_HEIGHT, monthGrid, onDay } from "./layout.ts";

/**
 * Days outside the month (design.html CO-8): sunk below the window's ground
 * in Light. Dark's ground is true black, with nothing below it, so there they
 * take the first lift instead: told apart, without a gray wash.
 */
export const OUTSIDE_WASH = { light: "#0000000a", dark: TRUE_BLACK.lift } as const;

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

/** Whether a dragged event's new times cover `day`. */
function covers(preview: { start: string; end: string; allDay: boolean }, day: Day): boolean {
  const last = preview.end > preview.start ? dayPart(addMinutes(preview.end, -1)) : dayPart(preview.start);
  return dayPart(preview.start) <= day && day <= last;
}

export function MonthView({ anchor, today, firstDay, prefs, occurrences, colorOf, state, handlers }: MonthViewProps) {
  const colors = useColors();
  const surface = useSurface();
  const dark = useDark();
  const weeks = monthGrid(anchor, firstDay);
  const { month } = monthOf(anchor);
  const [grid, setGrid] = useState<Bounds>({ x: 0, y: 0, width: 0, height: 494 });
  const capacity = chipCapacity(grid.height / weeks.length);
  const names = weekdayNames(prefs.locale, firstDay);
  const { drag, pending, selected, selectedEvent } = state;
  const preview = drag?.moved && drag.preview && drag.occurrence ? drag.preview : null;
  const draggedKey = preview && drag?.occurrence ? occurrenceKey(drag.occurrence) : null;
  // A narrow cell gives its chips' room to their titles: the time goes first.
  const timed = grid.width <= 0 || grid.width / 7 >= CHIP_TIME_FROM;
  const geometry = { days: weeks.flat(), columnWidth: grid.width / 7, dayAt: (x: number, y: number) => monthDayAt(grid, weeks, x, y) };

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
            {week.map((day, column) => {
              const here = onDay(occurrences, day);
              const naming = pending !== null && dayPart(pending.start) === day;
              const { shown, more } = fitChips(here, Math.max(0, capacity - (naming ? 1 : 0)));
              const isToday = day === today;
              const inMonth = monthOf(day).month === month;
              const target = preview && drag?.occurrence && covers(preview, day) ? tint(colorOf(drag.occurrence.calendarId), 0.2) : null;
              return (
                <View
                  key={day}
                  testID={`day:${day}`}
                  onPress={() => handlers.clickDay(day, null)}
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
                    backgroundColor: target ?? (inMonth ? "#00000000" : dark ? OUTSIDE_WASH.dark : OUTSIDE_WASH.light),
                    overflow: "hidden",
                  }}
                >
                  <View style={{ height: 20, flexShrink: 0, flexDirection: "row", justifyContent: "flex-end" }}>
                    <View
                      testID={`day-number:${day}`}
                      onPress={() => handlers.showDay(day)}
                      style={{
                        minWidth: 20,
                        height: 20,
                        paddingHorizontal: 4,
                        borderRadius: 10,
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                        // Today is an ink mark: green means "on".
                        backgroundColor: isToday ? colors.text : day === selected ? colors.button : "#00000000",
                        borderWidth: day === selected && !isToday ? 1 : 0,
                        borderColor: colors.selection,
                        hoverBackgroundColor: isToday ? colors.text : colors.button,
                      }}
                    >
                      <Text
                        numberOfLines={1}
                        style={{
                          fontSize: 12,
                          fontWeight: isToday ? "bold" : "normal",
                          color: isToday ? surface.window : inMonth ? colors.text : colors.textMuted,
                        }}
                      >
                        {day.endsWith("-01") ? monthDay(day, prefs) : dayNumber(day)}
                      </Text>
                    </View>
                  </View>
                  {naming && pending && (
                    <View style={{ height: MONTH_CHIP_HEIGHT - 1, flexShrink: 0 }}>
                      <InlineTitle
                        pending={pending}
                        chip
                        color={colorOf(pending.calendarId)}
                        onChange={handlers.pendingTitle}
                        onDone={handlers.savePending}
                        onCancel={handlers.dropPending}
                      />
                    </View>
                  )}
                  {shown.map((occurrence) => {
                    const key = occurrenceKey(occurrence);
                    return (
                      <EventChip
                        key={key}
                        occurrence={occurrence}
                        color={colorOf(occurrence.calendarId)}
                        day={day}
                        prefs={prefs}
                        timed={timed}
                        selected={selectedEvent === key}
                        dragged={draggedKey === key}
                        onPress={(bounds) => handlers.open(occurrence, bounds)}
                        onPointer={(info) =>
                          info.phase === "down" ? handlers.begin({ kind: "move-days", x: info.x, y: info.y, day, occurrence }, geometry) : handlers.track(info)
                        }
                      />
                    );
                  })}
                  {more > 0 && <MoreChip testID={`more:${day}`} count={more} onPress={() => handlers.showDay(day)} />}
                </View>
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
}
