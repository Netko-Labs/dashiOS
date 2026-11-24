/**
 * The month's day cells and what they need: the grid's shape and the drag
 * and the name being typed, shared by all of them.
 */

import { CLEAR, pill, SPACE, TRUE_BLACK, TYPE, useColors, useDark, useSurface, WEIGHT } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { addMinutes, type Day, dayPart, monthOf, type Occurrence } from "../../../../src/shared/calendar/index.ts";
import type { ClockPrefs } from "../../../../src/shared/time/index.ts";
import { tint } from "../colors.ts";
import { dayNumber, monthDay } from "../format.ts";
import { occurrenceKey } from "../grid/event-block.tsx";
import type { GridHandlers, GridState } from "../grid/grid-props.ts";
import { InlineTitle } from "../grid/inline-title.tsx";
import { MoreEvents } from "../grid/more-events.tsx";
import { fitChips, MONTH_CHIP_HEIGHT, onDay } from "../layout.ts";
import { EventLine } from "./chips.tsx";

/** A day's number on its disc; the cell's padding; the hairlines between cells; the ring round the picked day; a dragged event's wash. */
const NUMBER_DISC = 20;
const CELL_PADDING = SPACE.xxs;
const RULE = 1;
const PICKED_EDGE = 1;
const LANDING_WASH = 0.2;

/**
 * Days outside the month (design.html CO-8): sunk below the window's ground
 * in Light (a field's ground). Dark's ground is true black, with nothing
 * below it, so there they take the first lift instead: told apart, without a
 * gray wash.
 */
function outsideWash(dark: boolean, field: string): string {
  return dark ? TRUE_BLACK.lift : field;
}

/** Whether a dragged event's new times cover `day`. */
function covers(preview: { start: string; end: string; allDay: boolean }, day: Day): boolean {
  const last = preview.end > preview.start ? dayPart(addMinutes(preview.end, -1)) : dayPart(preview.start);
  return dayPart(preview.start) <= day && day <= last;
}

/** What every cell of the month shares. */
export interface MonthShared {
  today: Day;
  /** The month shown (1 to 12). */
  month: number;
  prefs: ClockPrefs;
  occurrences: readonly Occurrence[];
  colorOf: (calendarId: string) => string;
  state: GridState;
  handlers: GridHandlers;
  /** How many chips a cell holds. */
  capacity: number;
  /** A narrow cell gives its chips' room to their titles: the time goes first. */
  timed: boolean;
  weeks: number;
  geometry: Parameters<GridHandlers["begin"]>[1];
}

/** The day's number in its corner; a press shows that day. */
function DayNumber({
  day,
  isToday,
  inMonth,
  picked,
  prefs,
  onPress,
}: {
  day: Day;
  isToday: boolean;
  inMonth: boolean;
  picked: boolean;
  prefs: ClockPrefs;
  onPress: () => void;
}) {
  const colors = useColors();
  const surface = useSurface();
  return (
    <View style={{ height: NUMBER_DISC, flexShrink: 0, flexDirection: "row", justifyContent: "flex-end" }}>
      <View
        testID={`day-number:${day}`}
        onPress={onPress}
        style={{
          minWidth: NUMBER_DISC,
          height: NUMBER_DISC,
          paddingHorizontal: SPACE.xs,
          borderRadius: pill(NUMBER_DISC),
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          // Today is an ink mark: green means "on".
          backgroundColor: isToday ? colors.text : picked ? colors.button : CLEAR,
          borderWidth: picked && !isToday ? PICKED_EDGE : 0,
          borderColor: colors.selection,
          hoverBackgroundColor: isToday ? colors.text : colors.button,
        }}
      >
        <Text
          numberOfLines={1}
          style={{
            fontSize: TYPE.secondary.size,
            fontWeight: isToday ? WEIGHT.bold : WEIGHT.regular,
            color: isToday ? surface.window : inMonth ? colors.text : colors.textMuted,
          }}
        >
          {day.endsWith("-01") ? monthDay(day, prefs) : dayNumber(day)}
        </Text>
      </View>
    </View>
  );
}

export function DayCell({ day, row, column, shared }: { day: Day; row: number; column: number; shared: MonthShared }) {
  const colors = useColors();
  const surface = useSurface();
  const dark = useDark();
  const { today, month, prefs, occurrences, colorOf, state, handlers, capacity, timed, weeks, geometry } = shared;
  const { drag, pending, selected, selectedEvent } = state;
  const preview = drag?.moved && drag.preview && drag.occurrence ? drag.preview : null;
  const draggedKey = preview && drag?.occurrence ? occurrenceKey(drag.occurrence) : null;
  const here = onDay(occurrences, day);
  const naming = pending !== null && dayPart(pending.start) === day;
  const { shown, more } = fitChips(here, Math.max(0, capacity - (naming ? 1 : 0)));
  const isToday = day === today;
  const inMonth = monthOf(day).month === month;
  const target = preview && drag?.occurrence && covers(preview, day) ? tint(colorOf(drag.occurrence.calendarId), LANDING_WASH) : null;
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
        gap: SPACE.px,
        padding: CELL_PADDING,
        borderRightWidth: column === 6 ? 0 : RULE,
        borderBottomWidth: row === weeks - 1 ? 0 : RULE,
        borderColor: colors.separator,
        backgroundColor: target ?? (inMonth ? CLEAR : outsideWash(dark, surface.field)),
        overflow: "hidden",
      }}
    >
      <DayNumber day={day} isToday={isToday} inMonth={inMonth} picked={day === selected} prefs={prefs} onPress={() => handlers.showDay(day)} />
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
          <EventLine
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
      {more > 0 && <MoreEvents testID={`more:${day}`} count={more} onPress={() => handlers.showDay(day)} />}
    </View>
  );
}
