/**
 * The day and week views: a header with the days, a strip for all-day events,
 * and below, scrolling, the 24 hours with each timed event as a block at its
 * time (overlapping ones side by side) and a red line at the time now. A click
 * on an empty half hour makes an event there; on the strip, an all-day one.
 */

import { useColors } from "@dashi/ui";
import { ScrollView, Text, View } from "@mirinjs/metal";
import { useEffect, useState } from "react";
import type { ClockPrefs } from "../../src/clock.ts";
import { inkOn, tint } from "./colors.ts";
import type { Day } from "./dates.ts";
import { clock, dayNumber, hourLabel, titleOf, weekdayShort } from "./format.ts";
import { allDayOn, firstHour, GRID_HEIGHT, HOUR_HEIGHT, MONTH_CHIP_HEIGHT, type Placed, placeDay, yAtMinutes } from "./layout.ts";
import type { Occurrence } from "./types.ts";

const GUTTER = 58;
const ALL_DAY_ROWS = 4;
const HALF = HOUR_HEIGHT / 2;

export interface TimeGridProps {
  days: readonly Day[];
  today: Day;
  now: Date;
  prefs: ClockPrefs;
  occurrences: readonly Occurrence[];
  colorOf: (calendarId: string) => string;
  /** A click on an empty half hour (minutes after midnight), or on the all-day strip (null). */
  onNew: (day: Day, minutes: number | null) => void;
  onOpen: (occurrence: Occurrence) => void;
  /** A click on a day's name in the header. */
  onDay: (day: Day) => void;
  /** Scrolls the hours (the app's simulation channel; Metal has no scroll-into-view). */
  scroll: (testID: string, dy: number) => void;
}

function EventBlock({
  placed,
  color,
  width,
  prefs,
  onOpen,
}: {
  placed: Placed;
  color: string;
  width: number;
  prefs: ClockPrefs;
  onOpen: (occurrence: Occurrence) => void;
}) {
  const colors = useColors();
  const { occurrence } = placed;
  const { event } = occurrence;
  const top = yAtMinutes(placed.top);
  const height = Math.max(yAtMinutes(placed.bottom - placed.top) - 1, 16);
  const share = width > 0 ? (width - 6) / placed.columns : 0;
  const compact = height < 34;
  return (
    <View
      testID={`event:${occurrence.calendarId}:${event.uid}:${occurrence.start}`}
      onPress={() => onOpen(occurrence)}
      style={{
        position: "absolute",
        top,
        height,
        left: width > 0 ? 2 + placed.column * share : 2,
        width: width > 0 ? share - 2 : "100%",
        flexDirection: compact ? "row" : "column",
        gap: compact ? 5 : 1,
        alignItems: compact ? "center" : "flex-start",
        overflow: "hidden",
        paddingHorizontal: 6,
        paddingVertical: compact ? 0 : 3,
        borderRadius: 5,
        borderLeftWidth: 3,
        borderColor: color,
        backgroundColor: tint(color, 0.26),
        hoverBackgroundColor: tint(color, 0.4),
      }}
    >
      <View style={compact ? { flex: 1, minWidth: 0 } : { width: "100%" }}>
        <Text numberOfLines={1} style={{ fontSize: 11, fontWeight: "semibold", color: colors.text }}>
          {titleOf(event)}
        </Text>
      </View>
      <View style={{ flexShrink: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 10, color: colors.textMuted }}>
          {clock(occurrence.start, prefs)}
        </Text>
      </View>
      {!compact && event.location !== "" && (
        <Text numberOfLines={1} style={{ fontSize: 10, color: colors.textMuted }}>
          {event.location}
        </Text>
      )}
    </View>
  );
}

export function TimeGrid({ days, today, now, prefs, occurrences, colorOf, onNew, onOpen, onDay, scroll }: TimeGridProps) {
  const colors = useColors();
  const [columnWidth, setColumnWidth] = useState(0);
  const rows = Math.min(ALL_DAY_ROWS, Math.max(1, ...days.map((day) => allDayOn(occurrences, day).length)));
  const stripHeight = rows * MONTH_CHIP_HEIGHT + 8;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  // The hours scroll to the working day when the view opens.
  const top = HOUR_HEIGHT * firstHour(days.includes(today), now.getHours()) - 14;
  useEffect(() => {
    // The scroll offset outlives a switch between Day and Week, and a scroll is relative: back to the top first.
    const timer = setTimeout(() => {
      scroll("hours", -100_000);
      scroll("hours", Math.max(0, top));
    }, 80);
    return () => clearTimeout(timer);
    // Only a different kind of view (Day, Week) scrolls again; paging and the clock leave the hours where they are.
  }, [scroll, days.length]); // eslint-disable-line react-hooks/exhaustive-deps

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
              onPress={() => onDay(day)}
              style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 }}
            >
              <Text style={{ fontSize: 12, fontWeight: "semibold", color: isToday ? colors.selection : colors.textMuted }}>{weekdayShort(day, prefs)}</Text>
              <View
                style={{
                  minWidth: 26,
                  height: 26,
                  borderRadius: 13,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: isToday ? colors.selection : "#00000000",
                }}
              >
                <Text style={{ fontSize: 16, fontWeight: isToday ? "bold" : "normal", color: isToday ? "#ffffff" : colors.text }}>{dayNumber(day)}</Text>
              </View>
            </View>
          );
        })}
      </View>
      <View style={{ flexShrink: 0, flexDirection: "row", height: stripHeight, borderBottomWidth: 1, borderColor: colors.separator }}>
        <View style={{ width: GUTTER, flexShrink: 0, alignItems: "flex-end", paddingRight: 8, paddingTop: 5 }}>
          <Text style={{ fontSize: 10, color: colors.textMuted }}>all-day</Text>
        </View>
        {days.map((day) => {
          const all = allDayOn(occurrences, day);
          const shown = all.length > ALL_DAY_ROWS ? all.slice(0, ALL_DAY_ROWS - 1) : all;
          return (
            <View
              key={day}
              testID={`allday:${day}`}
              onPress={() => onNew(day, null)}
              style={{
                flex: 1,
                minWidth: 0,
                flexDirection: "column",
                gap: 1,
                padding: 3,
                borderLeftWidth: 1,
                borderColor: colors.separator,
                overflow: "hidden",
              }}
            >
              {shown.map((occurrence) => {
                const color = colorOf(occurrence.calendarId);
                return (
                  <View
                    key={`${occurrence.calendarId}:${occurrence.event.uid}:${occurrence.start}`}
                    testID={`chip:${occurrence.calendarId}:${occurrence.event.uid}:${occurrence.start}`}
                    onPress={() => onOpen(occurrence)}
                    style={{
                      height: MONTH_CHIP_HEIGHT - 1,
                      flexShrink: 0,
                      paddingHorizontal: 5,
                      borderRadius: 4,
                      justifyContent: "center",
                      backgroundColor: color,
                    }}
                  >
                    <Text numberOfLines={1} style={{ fontSize: 11, fontWeight: "semibold", color: inkOn(color) }}>
                      {titleOf(occurrence.event)}
                    </Text>
                  </View>
                );
              })}
              {all.length > shown.length && (
                <View
                  testID={`more:${day}`}
                  onPress={() => onDay(day)}
                  style={{ height: MONTH_CHIP_HEIGHT - 1, justifyContent: "center", paddingHorizontal: 5 }}
                >
                  <Text style={{ fontSize: 10, fontWeight: "semibold", color: colors.textMuted }}>{`${all.length - shown.length} more`}</Text>
                </View>
              )}
            </View>
          );
        })}
      </View>
      <ScrollView testID="hours" style={{ flex: 1, minHeight: 0 }}>
        <View style={{ flexDirection: "row", height: GRID_HEIGHT, flexShrink: 0 }}>
          <View style={{ width: GUTTER, flexShrink: 0, position: "relative" }}>
            {Array.from({ length: 24 }, (_, hour) => (
              <View key={hour} style={{ position: "absolute", top: hour * HOUR_HEIGHT - 7, right: 8, height: 14, justifyContent: "center" }}>
                {hour > 0 && <Text style={{ fontSize: 10, color: colors.textMuted }}>{hourLabel(hour, prefs)}</Text>}
              </View>
            ))}
          </View>
          {days.map((day, index) => {
            const placed = placeDay(occurrences, day);
            return (
              <View
                key={day}
                testID={`column:${day}`}
                onLayout={index === 0 ? (bounds) => setColumnWidth(bounds.width) : undefined}
                style={{ flex: 1, minWidth: 0, position: "relative", flexDirection: "column", borderLeftWidth: 1, borderColor: colors.separator }}
              >
                {Array.from({ length: 48 }, (_, slot) => (
                  <View
                    key={slot}
                    testID={`slot:${day}:${slot * 30}`}
                    onPress={() => onNew(day, slot * 30)}
                    style={{
                      height: HALF,
                      flexShrink: 0,
                      borderBottomWidth: slot % 2 === 1 ? 1 : 0,
                      borderColor: colors.separator,
                      hoverBackgroundColor: tint(colors.selection, 0.07),
                    }}
                  />
                ))}
                {placed.map((each) => (
                  <EventBlock
                    key={`${each.occurrence.calendarId}:${each.occurrence.event.uid}:${each.occurrence.start}`}
                    placed={each}
                    color={colorOf(each.occurrence.calendarId)}
                    width={columnWidth}
                    prefs={prefs}
                    onOpen={onOpen}
                  />
                ))}
                {day === today && (
                  <View testID="now" style={{ position: "absolute", left: 0, right: 0, top: yAtMinutes(nowMinutes) - 5, height: 10, justifyContent: "center" }}>
                    <View style={{ height: 2, backgroundColor: colors.critical }} />
                    <View style={{ position: "absolute", left: -4, width: 9, height: 9, borderRadius: 5, backgroundColor: colors.critical }} />
                  </View>
                )}
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}
