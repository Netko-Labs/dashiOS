/**
 * The day and week views: a header with the days, the strip of all-day
 * events (allday-strip.tsx), and below, scrolling, the 24 hours, a column
 * per day (day-column.tsx) with each timed event as a block at its time
 * (overlapping ones side by side) and the time now across them. The grid is
 * the editor: drawing on empty time makes an event, dragging moves or
 * stretches one (drag.ts).
 */

import { useColors, useSurface } from "@dashi/ui";
import { ScrollView, Text, View, type ViewHandle } from "@mirinjs/metal";
import { type RefObject, useEffect, useRef, useState } from "react";
import type { Day, Occurrence } from "../../../../src/shared/calendar/index.ts";
import type { ClockPrefs } from "../../../../src/shared/time/index.ts";
import { dayNumber, hourLabel, weekdayShort } from "../format.ts";
import { firstHour, GRID_HEIGHT, HOUR_HEIGHT, revealOffset } from "../layout.ts";
import { AllDayStrip } from "./allday-strip.tsx";
import { DayColumn } from "./day-column.tsx";
import type { GridHandlers, GridState } from "./grid-props.ts";

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
}

/** Where the hours are scrolled to: the working day when the view opens, and a new event made out of sight. */
function useHoursScroll(dayCount: number, top: number, reveal: GridState["reveal"]): RefObject<ViewHandle | null> {
  // The hours' scroll view: it is told where to stand (mirin's `ViewHandle`; a host from before it leaves the hours at midnight, D134).
  const hours = useRef<ViewHandle>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a different kind of view (Day, Week) scrolls again; paging and the clock leave the hours be
  useEffect(() => {
    // Not at once: a scroll asked of a view in the turn it is mounted is lost (the VM showed the hours left at midnight).
    const timer = setTimeout(() => hours.current?.scrollTo({ y: Math.max(0, top) }), 80);
    return () => clearTimeout(timer);
  }, [dayCount]);

  // A new event from the + button starts where the hours may be scrolled away from: they scroll to it.
  useEffect(() => {
    if (reveal !== null) hours.current?.scrollTo({ y: revealOffset(reveal.minutes) });
  }, [reveal]);
  return hours;
}

/** A day's name and number over its column; a press shows that day. */
function DayHead({
  day,
  isToday,
  picked,
  stacked,
  prefs,
  onPress,
}: {
  day: Day;
  isToday: boolean;
  picked: boolean;
  stacked: boolean;
  prefs: ClockPrefs;
  onPress: () => void;
}) {
  const colors = useColors();
  const surface = useSurface();
  return (
    <View
      testID={`head:${day}`}
      onPress={onPress}
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
      <View style={{ flexShrink: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: "semibold", color: isToday ? colors.text : colors.textMuted }}>
          {weekdayShort(day, prefs)}
        </Text>
      </View>
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
          backgroundColor: isToday ? colors.text : picked ? colors.button : "#00000000",
        }}
      >
        <Text style={{ fontSize: 16, fontWeight: isToday ? "bold" : "normal", color: isToday ? surface.window : colors.text }}>{dayNumber(day)}</Text>
      </View>
    </View>
  );
}

export function TimeGrid({ days, today, now, prefs, occurrences, colorOf, state, handlers }: TimeGridProps) {
  const colors = useColors();
  const [columnWidth, setColumnWidth] = useState(0);
  const stacked = columnWidth > 0 && columnWidth < STACK_HEAD_BELOW;
  const showsToday = days.includes(today);
  const nowMinutes = showsToday ? now.getHours() * 60 + now.getMinutes() : null;

  const hours = useHoursScroll(days.length, HOUR_HEIGHT * firstHour(showsToday, now.getHours()) - 14, state.reveal);

  return (
    <View testID="time-grid" style={{ flex: 1, flexDirection: "column", minHeight: 0 }}>
      <View style={{ flexShrink: 0, flexDirection: "row", height: days.length === 1 ? 52 : 46, borderBottomWidth: 1, borderColor: colors.separator }}>
        <View style={{ width: GUTTER, flexShrink: 0 }} />
        {days.map((day) => (
          <DayHead
            key={day}
            day={day}
            isToday={day === today}
            picked={day === state.selected && days.length > 1}
            stacked={stacked}
            prefs={prefs}
            onPress={() => handlers.showDay(day)}
          />
        ))}
      </View>
      <AllDayStrip days={days} occurrences={occurrences} colorOf={colorOf} gutter={GUTTER} columnWidth={columnWidth} state={state} handlers={handlers} />
      <ScrollView testID="hours" ref={hours} style={{ flex: 1, minHeight: 0 }}>
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
