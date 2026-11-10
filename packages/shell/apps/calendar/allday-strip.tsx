/**
 * The day and week views' strip of all-day events, above the hours: a chip
 * per event (dragged to another day, it moves there), "N more" when they do
 * not all fit, and a new all-day event named in place. A click on its empty
 * part picks the day; a double click makes an event there.
 */

import { useColors } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { type Day, dayPart } from "../../src/shared/calendar/dates.ts";
import type { Occurrence } from "../../src/shared/calendar/types.ts";
import { inkOn, tint } from "./colors.ts";
import { occurrenceKey } from "./event-block.tsx";
import { titleOf } from "./format.ts";
import type { GridHandlers, GridState } from "./grid-props.ts";
import { InlineTitle } from "./inline-title.tsx";
import { allDayOn, MONTH_CHIP_HEIGHT } from "./layout.ts";

export const ALL_DAY_ROWS = 4;

/** Whether an all-day preview covers `day`. */
const covers = (preview: { start: string; end: string }, day: Day): boolean => dayPart(preview.start) <= day && day < dayPart(preview.end);

export function AllDayStrip({
  days,
  occurrences,
  colorOf,
  gutter,
  columnWidth,
  state,
  handlers,
}: {
  days: readonly Day[];
  occurrences: readonly Occurrence[];
  colorOf: (calendarId: string) => string;
  gutter: number;
  columnWidth: number;
  state: GridState;
  handlers: GridHandlers;
}) {
  const colors = useColors();
  const { drag, pending, selectedEvent } = state;
  const ghost = drag?.moved && drag.preview?.allDay && drag.occurrence ? { ...drag.preview, occurrence: drag.occurrence } : null;
  const pendingDay = pending?.allDay ? dayPart(pending.start) : null;
  const rows = Math.min(ALL_DAY_ROWS, Math.max(1, ...days.map((day) => allDayOn(occurrences, day).length + (day === pendingDay ? 1 : 0))));
  const geometry = { days, columnWidth };
  return (
    <View style={{ flexShrink: 0, flexDirection: "row", height: rows * MONTH_CHIP_HEIGHT + 8, borderBottomWidth: 1, borderColor: colors.separator }}>
      <View style={{ width: gutter, flexShrink: 0, alignItems: "flex-end", paddingRight: 8, paddingTop: 5 }}>
        <Text style={{ fontSize: 10, color: colors.textMuted }}>All-day</Text>
      </View>
      {days.map((day) => {
        const all = allDayOn(occurrences, day);
        const room = ALL_DAY_ROWS - (day === pendingDay ? 1 : 0);
        const shown = all.length > room ? all.slice(0, Math.max(0, room - 1)) : all;
        return (
          <View
            key={day}
            testID={`allday:${day}`}
            onPress={() => handlers.clickDay(day, null)}
            style={{
              flex: 1,
              minWidth: 0,
              flexDirection: "column",
              gap: 1,
              padding: 3,
              borderLeftWidth: 1,
              borderColor: colors.separator,
              overflow: "hidden",
              backgroundColor: ghost && covers(ghost, day) ? tint(colorOf(ghost.occurrence.calendarId), 0.18) : "#00000000",
            }}
          >
            {pending && day === pendingDay && (
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
              const color = colorOf(occurrence.calendarId);
              const key = occurrenceKey(occurrence);
              const dragged = drag?.moved === true && drag.occurrence !== undefined && occurrenceKey(drag.occurrence) === key;
              return (
                <View
                  key={key}
                  testID={`chip:${key}`}
                  focusable
                  accessibilityRole="button"
                  onPress={(info) => handlers.open(occurrence, info.bounds)}
                  onPointer={(info) =>
                    info.phase === "down" ? handlers.begin({ kind: "move-days", x: info.x, y: info.y, day, occurrence }, geometry) : handlers.track(info)
                  }
                  style={{
                    height: MONTH_CHIP_HEIGHT - 1,
                    flexShrink: 0,
                    paddingHorizontal: 5,
                    borderRadius: 4,
                    justifyContent: "center",
                    backgroundColor: color,
                    borderWidth: selectedEvent === key ? 2 : 0,
                    borderColor: colors.text,
                    opacity: dragged ? 0.35 : 1,
                    focusRingColor: colors.focusRing,
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
                onPress={() => handlers.showDay(day)}
                style={{ height: MONTH_CHIP_HEIGHT - 1, justifyContent: "center", paddingHorizontal: 5 }}
              >
                <Text numberOfLines={1} style={{ fontSize: 10, fontWeight: "semibold", color: colors.textMuted }}>{`${all.length - shown.length} more`}</Text>
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}
