/**
 * The day and week views' strip of all-day events, above the hours: a chip
 * per event (dragged to another day, it moves there), "N more" when they do
 * not all fit, and a new all-day event named in place. A click on its empty
 * part picks the day; a double click makes an event there.
 */

import { CLEAR, OPACITY, RADIUS, SPACE, TYPE, useColors, WEIGHT } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { type Day, dayPart, type Occurrence } from "../../../../src/shared/calendar/index.ts";
import { inkOn, tint } from "../colors.ts";
import { titleOf } from "../format.ts";
import { allDayOn, MONTH_CHIP_HEIGHT } from "../layout.ts";
import { occurrenceKey, PICKED_RING } from "./event-block.tsx";
import type { GridHandlers, GridState } from "./grid-props.ts";
import { InlineTitle } from "./inline-title.tsx";
import { MoreEvents } from "./more-events.tsx";

export const ALL_DAY_ROWS = 4;
/** A day's cell: its padding round the bars, and the wash of a dragged event over the days it would cover. */
const CELL_PADDING = 3;
const LANDING_WASH = 0.18;
/** The strip's room under its rows, the hairlines, and where "All-day" sits in the gutter. */
const STRIP_FOOT = 8;
const RULE = 1;

/** Whether an all-day preview covers `day`. */
const covers = (preview: { start: string; end: string }, day: Day): boolean => dayPart(preview.start) <= day && day < dayPart(preview.end);

/** One all-day event, a bar in its calendar's colour: a press opens it, a drag moves it to another day. */
function AllDayBar({
  occurrence,
  color,
  day,
  geometry,
  state,
  handlers,
}: {
  occurrence: Occurrence;
  color: string;
  day: Day;
  geometry: { days: readonly Day[]; columnWidth: number };
  state: GridState;
  handlers: GridHandlers;
}) {
  const colors = useColors();
  const { drag, selectedEvent } = state;
  const key = occurrenceKey(occurrence);
  const dragged = drag?.moved === true && drag.occurrence !== undefined && occurrenceKey(drag.occurrence) === key;
  return (
    <View
      testID={`chip:${key}`}
      focusable
      // An event is a thing the person picks, not a button.
      accessibilityRole="option"
      accessibilityState={{ selected: selectedEvent === key }}
      accessibilityLabel={titleOf(occurrence.event)}
      onPress={(info) => handlers.open(occurrence, info.bounds)}
      onPointer={(info) =>
        info.phase === "down" ? handlers.begin({ kind: "move-days", x: info.x, y: info.y, day, occurrence }, geometry) : handlers.track(info)
      }
      style={{
        height: MONTH_CHIP_HEIGHT - 1,
        flexShrink: 0,
        paddingHorizontal: SPACE.xs,
        borderRadius: RADIUS.check,
        justifyContent: "center",
        backgroundColor: color,
        borderWidth: selectedEvent === key ? PICKED_RING : 0,
        borderColor: colors.text,
        opacity: dragged ? OPACITY.disabled : 1,
        focusRingColor: colors.focusRing,
      }}
    >
      <Text numberOfLines={1} style={{ fontSize: TYPE.caption.size, fontWeight: WEIGHT.semibold, color: inkOn(color) }}>
        {titleOf(occurrence.event)}
      </Text>
    </View>
  );
}

/** One day of the strip: its chips, a new event being named, and "N more". */
function AllDayCell({
  day,
  occurrences,
  colorOf,
  geometry,
  ghost,
  state,
  handlers,
}: {
  day: Day;
  occurrences: readonly Occurrence[];
  colorOf: (calendarId: string) => string;
  geometry: { days: readonly Day[]; columnWidth: number };
  /** The all-day event being dragged, where it would land. */
  ghost: { start: string; end: string; occurrence: Occurrence } | null;
  state: GridState;
  handlers: GridHandlers;
}) {
  const colors = useColors();
  const { pending } = state;
  const pendingDay = pending?.allDay ? dayPart(pending.start) : null;
  const all = allDayOn(occurrences, day);
  const room = ALL_DAY_ROWS - (day === pendingDay ? 1 : 0);
  const shown = all.length > room ? all.slice(0, Math.max(0, room - 1)) : all;
  return (
    <View
      testID={`allday:${day}`}
      onPress={() => handlers.clickDay(day, null)}
      style={{
        flex: 1,
        minWidth: 0,
        flexDirection: "column",
        gap: SPACE.px,
        padding: CELL_PADDING,
        borderLeftWidth: RULE,
        borderColor: colors.separator,
        overflow: "hidden",
        backgroundColor: ghost && covers(ghost, day) ? tint(colorOf(ghost.occurrence.calendarId), LANDING_WASH) : CLEAR,
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
      {shown.map((occurrence) => (
        <AllDayBar
          key={occurrenceKey(occurrence)}
          occurrence={occurrence}
          color={colorOf(occurrence.calendarId)}
          day={day}
          geometry={geometry}
          state={state}
          handlers={handlers}
        />
      ))}
      {all.length > shown.length && <MoreEvents testID={`more:${day}`} count={all.length - shown.length} onPress={() => handlers.showDay(day)} />}
    </View>
  );
}

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
  const { drag, pending } = state;
  const ghost = drag?.moved && drag.preview?.allDay && drag.occurrence ? { ...drag.preview, occurrence: drag.occurrence } : null;
  const pendingDay = pending?.allDay ? dayPart(pending.start) : null;
  const rows = Math.min(ALL_DAY_ROWS, Math.max(1, ...days.map((day) => allDayOn(occurrences, day).length + (day === pendingDay ? 1 : 0))));
  const geometry = { days, columnWidth };
  return (
    <View
      style={{ flexShrink: 0, flexDirection: "row", height: rows * MONTH_CHIP_HEIGHT + STRIP_FOOT, borderBottomWidth: RULE, borderColor: colors.separator }}
    >
      <View style={{ width: gutter, flexShrink: 0, alignItems: "flex-end", paddingRight: SPACE.m, paddingTop: SPACE.xs }}>
        <Text style={{ fontSize: TYPE.caption.size, color: colors.textMuted }}>All-day</Text>
      </View>
      {days.map((day) => (
        <AllDayCell key={day} day={day} occurrences={occurrences} colorOf={colorOf} geometry={geometry} ghost={ghost} state={state} handlers={handlers} />
      ))}
    </View>
  );
}
