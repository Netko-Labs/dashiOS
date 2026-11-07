/**
 * One day of the time grid: its 24 hours, the timed events on it, where a
 * drag would put one, a new event being named, the half hour picked, and the
 * time now. Pressing empty time and dragging draws a new event; a click picks
 * the half hour, a second click on it makes an hour-long event there.
 */

import { useColors } from "@dashi/ui";
import { View } from "@mirinjs/metal";
import type { ClockPrefs } from "../../src/clock.ts";
import { tint } from "./colors.ts";
import { addDays, type Day, dayPart, type Local, minuteOfDay } from "./dates.ts";
import { minutesFor } from "./drag.ts";
import { EventBlock, GhostBlock, occurrenceKey } from "./event-block.tsx";
import { timeSpan, titleOf } from "./format.ts";
import type { GridHandlers, GridState } from "./grid-props.ts";
import { InlineTitle } from "./inline-title.tsx";
import { GRID_HEIGHT, HOUR_HEIGHT, placeDay, yAtMinutes } from "./layout.ts";
import type { Occurrence } from "./types.ts";

const HALF = HOUR_HEIGHT / 2;

/** The part of [start, end) on `day`, as minutes after its midnight; null when none is. */
export function segmentOn(start: Local, end: Local, day: Day): { top: number; bottom: number } | null {
  const from = `${day}T00:00`;
  const to = `${addDays(day, 1)}T00:00`;
  if (!(end > from && start < to)) return null;
  return { top: start < from ? 0 : minuteOfDay(start), bottom: end >= to ? 1440 : minuteOfDay(end) };
}

export interface DayColumnProps {
  day: Day;
  days: readonly Day[];
  isToday: boolean;
  /** Minutes after midnight now, when today is among the days shown. */
  nowMinutes: number | null;
  prefs: ClockPrefs;
  occurrences: readonly Occurrence[];
  colorOf: (calendarId: string) => string;
  columnWidth: number;
  onWidth?: (width: number) => void;
  state: GridState;
  handlers: GridHandlers;
}

export function DayColumn({ day, days, isToday, nowMinutes, prefs, occurrences, colorOf, columnWidth, onWidth, state, handlers }: DayColumnProps) {
  const colors = useColors();
  const { drag, pending, selected, selectedSlot, selectedEvent } = state;
  const geometry = { days, columnWidth };
  const draggedKey = drag?.moved && drag.occurrence ? occurrenceKey(drag.occurrence) : null;
  const preview = drag?.moved && drag.preview && !drag.preview.allDay ? drag.preview : null;
  const ghost = preview ? segmentOn(preview.start, preview.end, day) : null;
  const ghostColor = drag?.occurrence ? colorOf(drag.occurrence.calendarId) : pending ? colorOf(pending.calendarId) : colors.selection;
  const placed = placeDay(occurrences, day);
  const pendingHere = pending && !pending.allDay ? segmentOn(pending.start, pending.end, day) : null;
  return (
    <View
      testID={`column:${day}`}
      onLayout={onWidth ? (bounds) => onWidth(bounds.width) : undefined}
      onPointer={(info) =>
        info.phase === "down"
          ? handlers.begin({ kind: "create", x: info.x, y: info.y, day, minutes: minutesFor(info.y - (info.bounds?.y ?? info.y)) }, geometry)
          : handlers.track(info)
      }
      style={{ flex: 1, minWidth: 0, height: GRID_HEIGHT, position: "relative", flexDirection: "column", borderLeftWidth: 1, borderColor: colors.separator }}
    >
      {Array.from({ length: 24 }, (_, hour) => (
        <View key={hour} style={{ height: HOUR_HEIGHT, flexShrink: 0, borderBottomWidth: 1, borderColor: colors.separator }} />
      ))}
      {day === selected && selectedSlot !== null && (
        <View
          testID="selected-slot"
          style={{ position: "absolute", left: 0, right: 0, top: yAtMinutes(selectedSlot), height: HALF, backgroundColor: tint(colors.selection, 0.14) }}
        />
      )}
      {placed.map((each) => {
        const key = occurrenceKey(each.occurrence);
        return (
          <EventBlock
            key={key}
            placed={each}
            color={colorOf(each.occurrence.calendarId)}
            width={columnWidth}
            prefs={prefs}
            selected={selectedEvent === key}
            dragged={draggedKey === key}
            resizable={dayPart(each.occurrence.end) === day || each.occurrence.end === `${addDays(day, 1)}T00:00`}
            onPointer={(kind, info) =>
              info.phase === "down" ? handlers.begin({ kind, x: info.x, y: info.y, day, occurrence: each.occurrence }, geometry) : handlers.track(info)
            }
            onPress={(bounds) => handlers.open(each.occurrence, bounds)}
          />
        );
      })}
      {preview && ghost && (
        <GhostBlock
          top={ghost.top}
          bottom={ghost.bottom}
          color={ghostColor}
          title={drag?.occurrence ? titleOf(drag.occurrence.event) : "New Event"}
          times={timeSpan({ allDay: false }, preview.start, preview.end, prefs)}
        />
      )}
      {pending && pendingHere && (
        <View
          style={{
            position: "absolute",
            left: 2,
            right: 4,
            top: yAtMinutes(pendingHere.top),
            height: Math.max(yAtMinutes(pendingHere.bottom - pendingHere.top) - 1, 20),
          }}
        >
          <InlineTitle
            pending={pending}
            color={colorOf(pending.calendarId)}
            label={timeSpan({ allDay: false }, pending.start, pending.end, prefs)}
            onChange={handlers.pendingTitle}
            onDone={handlers.savePending}
            onCancel={handlers.dropPending}
          />
        </View>
      )}
      {nowMinutes !== null && (
        // The time now runs across every day shown, in kombu; today's has the dot.
        <View
          testID={isToday ? "now" : undefined}
          style={{ position: "absolute", left: 0, right: 0, top: yAtMinutes(nowMinutes) - 5, height: 10, justifyContent: "center" }}
        >
          <View style={{ height: isToday ? 2 : 1, backgroundColor: isToday ? colors.selection : tint(colors.selection, 0.45) }} />
          {isToday && <View style={{ position: "absolute", left: -5, width: 10, height: 10, borderRadius: 5, backgroundColor: colors.selection }} />}
        </View>
      )}
    </View>
  );
}
