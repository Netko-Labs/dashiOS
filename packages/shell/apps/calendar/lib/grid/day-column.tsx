/**
 * One day of the time grid: its 24 hours, the timed events on it, where a
 * drag would put one, a new event being named, the half hour picked, and the
 * time now. Pressing empty time and dragging draws a new event; a click picks
 * the half hour, a second click on it makes an hour-long event there.
 */

import { pill, useColors } from "@dashi/ui";
import { View } from "@mirinjs/metal";
import { addDays, type Day, dayPart, type Local, minuteOfDay, type Occurrence } from "../../../../src/shared/calendar/index.ts";
import type { ClockPrefs } from "../../../../src/shared/time/index.ts";
import { tint } from "../colors.ts";
import { timeSpan, titleOf } from "../format.ts";
import { GRID_HEIGHT, HOUR_HEIGHT, placeDay, yAtMinutes } from "../layout.ts";
import { minutesFor } from "./drag.ts";
import { EventBlock, GhostBlock, occurrenceKey } from "./event-block.tsx";
import type { GridHandlers, GridState } from "./grid-props.ts";
import { InlineTitle } from "./inline-title.tsx";

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

/** The 24 hours' rules. */
function HourLines() {
  const colors = useColors();
  return Array.from({ length: 24 }, (_, hour) => (
    <View key={hour} style={{ height: HOUR_HEIGHT, flexShrink: 0, borderBottomWidth: RULE, borderColor: colors.separator }} />
  ));
}

/** The now line's dot on today's column, and the line: 2 thick there, 1 on the other days. */
const NOW_DOT = 10;
const NOW_LINE = { today: 2, other: 1 } as const;
/** A half hour picked, washed in the accent (it is chosen); a new event being named keeps clear of its column's sides, and at least this tall. */
const PICKED_WASH = 0.14;
const PENDING = { left: 2, right: 4, least: 20 } as const;
/** The hour rules. */
const RULE = 1;

/**
 * The time now runs across every day shown, in ink (CO-2: the accent means
 * chosen or on, never the time): today's line 2 thick in ink with its dot,
 * the other days' 1 thick in muted ink, as today's mark in the heads is ink.
 */
function NowLine({ minutes, isToday }: { minutes: number; isToday: boolean }) {
  const colors = useColors();
  return (
    <View
      testID={isToday ? "now" : undefined}
      style={{ position: "absolute", left: 0, right: 0, top: yAtMinutes(minutes) - NOW_DOT / 2, height: NOW_DOT, justifyContent: "center" }}
    >
      <View style={{ height: isToday ? NOW_LINE.today : NOW_LINE.other, backgroundColor: isToday ? colors.text : colors.textMuted }} />
      {isToday && (
        <View
          style={{ position: "absolute", left: -NOW_DOT / 2, width: NOW_DOT, height: NOW_DOT, borderRadius: pill(NOW_DOT), backgroundColor: colors.text }}
        />
      )}
    </View>
  );
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
      style={{ flex: 1, minWidth: 0, height: GRID_HEIGHT, position: "relative", flexDirection: "column", borderLeftWidth: RULE, borderColor: colors.separator }}
    >
      <HourLines />
      {day === selected && selectedSlot !== null && (
        <View
          testID="selected-slot"
          style={{ position: "absolute", left: 0, right: 0, top: yAtMinutes(selectedSlot), height: HALF, backgroundColor: tint(colors.selection, PICKED_WASH) }}
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
          title={drag?.occurrence ? titleOf(drag.occurrence.event) : "New event"}
          times={timeSpan({ allDay: false }, preview.start, preview.end, prefs)}
        />
      )}
      {pending && pendingHere && (
        <View
          style={{
            position: "absolute",
            left: PENDING.left,
            right: PENDING.right,
            top: yAtMinutes(pendingHere.top),
            height: Math.max(yAtMinutes(pendingHere.bottom - pendingHere.top) - 1, PENDING.least),
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
      {nowMinutes !== null && <NowLine minutes={nowMinutes} isToday={isToday} />}
    </View>
  );
}
