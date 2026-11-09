/**
 * The day and week views: a header with the days, the strip of all-day
 * events (allday-strip.tsx), and below, scrolling, the 24 hours, a column
 * per day (day-column.tsx) with each timed event as a block at its time
 * (overlapping ones side by side) and the time now across them. The grid is
 * the editor: drawing on empty time makes an event, dragging moves or
 * stretches one (drag.ts).
 */

import { useColors, useSurface } from "@dashi/ui";
import { ScrollView, Text, View } from "@mirinjs/metal";
import { useEffect, useState } from "react";
import type { ClockPrefs } from "../../src/clock.ts";
import { AllDayStrip } from "./allday-strip.tsx";
import type { Day } from "./dates.ts";
import { DayColumn } from "./day-column.tsx";
import { dayNumber, hourLabel, weekdayShort } from "./format.ts";
import type { GridHandlers, GridState } from "./grid-props.ts";
import { firstHour, GRID_HEIGHT, HOUR_HEIGHT, revealOffset } from "./layout.ts";
import type { Occurrence } from "./types.ts";

const GUTTER = 58;
/** Below this column width a day's name sits over its number, so the two never print over a neighbour's. */
export const STACK_HEAD_BELOW = 76;

export interface TimeGridProps {
  days: readonly Day[];
  today: Day;
  now: Date;
  prefs: ClockPrefs;
  occurrences: readonly Occurrence[];
  colorOf: (calendarId: string) => string;
  state: GridState;
  handlers: GridHandlers;
  /** Scrolls the hours (the app's simulation channel; Metal has no scroll-into-view). */
  scroll: (testID: string, dy: number) => void;
}

export function TimeGrid({ days, today, now, prefs, occurrences, colorOf, state, handlers, scroll }: TimeGridProps) {
  const colors = useColors();
  const surface = useSurface();
  const [columnWidth, setColumnWidth] = useState(0);
  const stacked = columnWidth > 0 && columnWidth < STACK_HEAD_BELOW;
  const showsToday = days.includes(today);
  const nowMinutes = showsToday ? now.getHours() * 60 + now.getMinutes() : null;

  // The hours scroll to the working day when the view opens.
  const top = HOUR_HEIGHT * firstHour(showsToday, now.getHours()) - 14;
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a different kind of view (Day, Week) scrolls again; paging and the clock leave the hours be
  useEffect(() => {
    // The scroll offset outlives a switch between Day and Week, and a scroll is relative: back to the top first.
    const timer = setTimeout(() => {
      scroll("hours", -100_000);
      scroll("hours", Math.max(0, top));
    }, 80);
    return () => clearTimeout(timer);
  }, [scroll, days.length]);

  // A new event from the + button starts where the hours may be scrolled away from: they scroll to it.
  const reveal = state.reveal;
  useEffect(() => {
    if (reveal === null) return;
    scroll("hours", -100_000);
    scroll("hours", revealOffset(reveal.minutes));
  }, [scroll, reveal]);

  return (
    <View testID="time-grid" style={{ flex: 1, flexDirection: "column", minHeight: 0 }}>
      <View style={{ flexShrink: 0, flexDirection: "row", height: days.length === 1 ? 52 : 46, borderBottomWidth: 1, borderColor: colors.separator }}>
        <View style={{ width: GUTTER, flexShrink: 0 }} />
        {days.map((day) => {
          const isToday = day === today;
          return (
            <View
              key={day}
              testID={`head:${day}`}
              onPress={() => handlers.showDay(day)}
              style={{
                flex: 1,
                minWidth: 0,
                flexDirection: stacked ? "column" : "row",
                alignItems: "center",
                justifyContent: "center",
                gap: stacked ? 1 : 7,
                overflow: "hidden",
              }}
            >
              <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: "semibold", color: isToday ? colors.text : colors.textMuted }}>
                {weekdayShort(day, prefs)}
              </Text>
              {/* Today is an ink mark: green means "on". */}
              <View
                style={{
                  minWidth: 26,
                  height: 26,
                  flexShrink: 0,
                  paddingHorizontal: 3,
                  borderRadius: 13,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: isToday ? colors.text : day === state.selected && days.length > 1 ? colors.button : "#00000000",
                }}
              >
                <Text numberOfLines={1} style={{ fontSize: 16, fontWeight: isToday ? "bold" : "normal", color: isToday ? surface.window : colors.text }}>
                  {dayNumber(day)}
                </Text>
              </View>
            </View>
          );
        })}
      </View>
      <AllDayStrip days={days} occurrences={occurrences} colorOf={colorOf} gutter={GUTTER} columnWidth={columnWidth} state={state} handlers={handlers} />
      <ScrollView testID="hours" style={{ flex: 1, minHeight: 0 }}>
        <View style={{ flexDirection: "row", height: GRID_HEIGHT, flexShrink: 0 }}>
          <View style={{ width: GUTTER, flexShrink: 0, position: "relative" }}>
            {Array.from({ length: 24 }, (_, hour) => (
              <View key={hour} style={{ position: "absolute", top: hour * HOUR_HEIGHT - 7, right: 8, height: 14, justifyContent: "center" }}>
                {hour > 0 && <Text style={{ fontSize: 10, color: colors.textMuted }}>{hourLabel(hour, prefs)}</Text>}
              </View>
            ))}
          </View>
          {days.map((day, index) => (
            <DayColumn
              key={day}
              day={day}
              days={days}
              isToday={day === today}
              nowMinutes={nowMinutes}
              prefs={prefs}
              occurrences={occurrences}
              colorOf={colorOf}
              columnWidth={columnWidth}
              onWidth={index === 0 ? setColumnWidth : undefined}
              state={state}
              handlers={handlers}
            />
          ))}
        </View>
      </ScrollView>
    </View>
  );
}
