/**
 * An event as a line in a month cell: a solid bar for all-day events (and a
 * timed one on a day after its first), a dot and the time for the rest.
 * Pressing it shows its popover; dragging it to another day moves it there.
 * An event is a thing the person picks (role option, its state selected),
 * not a button or a status chip; "3 more" is grid/more-events.tsx.
 */

import { CLEAR, OPACITY, pill, RADIUS, SPACE, TYPE, useColors, WEIGHT } from "@dashi/ui";
import { type Bounds, type PointerInfo, Text, View } from "@mirinjs/metal";
import { dayPart, type Occurrence } from "../../../../src/shared/calendar/index.ts";
import type { ClockPrefs } from "../../../../src/shared/time/index.ts";
import { inkOn, tint } from "../colors.ts";
import { clockShort, titleOf } from "../format.ts";
import { occurrenceKey, PICKED_RING } from "../grid/event-block.tsx";
import { MONTH_CHIP_HEIGHT } from "../layout.ts";

/** A timed event's dot, and its colour's wash when it is picked or under the pointer. */
const DOT = 6;
const WASH = { picked: 0.3, pickedHover: 0.36, hover: 0.18 } as const;

interface LinePress {
  testID: string;
  focusable: boolean;
  accessibilityRole: "option";
  accessibilityState: { selected: boolean };
  accessibilityLabel: string;
  onPress: (info: { bounds?: Bounds }) => void;
  onPointer: (info: PointerInfo) => void;
}

/** An all-day event, or a timed one that began on an earlier day: a bar in its calendar's colour. */
function EventBar({ common, color, title, selected, dragged }: { common: LinePress; color: string; title: string; selected: boolean; dragged: boolean }) {
  const colors = useColors();
  return (
    <View
      {...common}
      style={{
        height: MONTH_CHIP_HEIGHT - 1,
        flexShrink: 0,
        paddingHorizontal: SPACE.xs,
        borderRadius: RADIUS.check,
        justifyContent: "center",
        backgroundColor: color,
        borderWidth: selected ? PICKED_RING : 0,
        borderColor: colors.text,
        opacity: dragged ? OPACITY.disabled : 1,
        focusRingColor: colors.focusRing,
      }}
    >
      <Text numberOfLines={1} style={{ fontSize: TYPE.caption.size, fontWeight: WEIGHT.semibold, color: inkOn(color) }}>
        {title}
      </Text>
    </View>
  );
}

export function EventLine({
  occurrence,
  color,
  day,
  prefs,
  timed = true,
  selected,
  dragged,
  onPress,
  onPointer,
}: {
  occurrence: Occurrence;
  color: string;
  day: string;
  prefs: ClockPrefs;
  /** The cell has room for the start after the title. */
  timed?: boolean;
  selected: boolean;
  dragged: boolean;
  onPress: (bounds: Bounds | undefined) => void;
  onPointer: (info: PointerInfo) => void;
}) {
  const colors = useColors();
  const { event } = occurrence;
  const title = titleOf(event);
  // A timed event that began on an earlier day is a bar on this one.
  const bar = event.allDay || dayPart(occurrence.start) < day;
  const common: LinePress = {
    testID: `chip:${occurrenceKey(occurrence)}`,
    focusable: true,
    accessibilityRole: "option",
    accessibilityState: { selected },
    accessibilityLabel: title,
    onPress: (info: { bounds?: Bounds }) => onPress(info.bounds),
    onPointer,
  };
  if (bar) return <EventBar common={common} color={color} title={title} selected={selected} dragged={dragged} />;
  return (
    <View
      {...common}
      style={{
        height: MONTH_CHIP_HEIGHT - 1,
        flexShrink: 0,
        flexDirection: "row",
        alignItems: "center",
        gap: SPACE.s,
        paddingHorizontal: SPACE.xxs,
        borderRadius: RADIUS.check,
        backgroundColor: selected ? tint(color, WASH.picked) : CLEAR,
        hoverBackgroundColor: tint(color, selected ? WASH.pickedHover : WASH.hover),
        opacity: dragged ? OPACITY.disabled : 1,
        focusRingColor: colors.focusRing,
      }}
    >
      <View style={{ width: DOT, height: DOT, borderRadius: pill(DOT), backgroundColor: color, flexShrink: 0 }} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: TYPE.caption.size, color: colors.text }}>
          {title}
        </Text>
      </View>
      {timed && (
        <View style={{ flexShrink: 0 }}>
          <Text numberOfLines={1} style={{ fontSize: TYPE.caption.size, color: colors.textMuted }}>
            {clockShort(occurrence.start, prefs)}
          </Text>
        </View>
      )}
    </View>
  );
}
