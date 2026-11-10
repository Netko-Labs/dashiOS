/**
 * An event as a line in a month cell: a solid bar for all-day events (and a
 * timed one on a day after its first), a dot and the time for the rest.
 * Pressing it shows its popover; dragging it to another day moves it there.
 */

import { useColors } from "@dashi/ui";
import { type Bounds, type PointerInfo, Text, View } from "@mirinjs/metal";
import { dayPart } from "../../../../src/shared/calendar/dates.ts";
import type { Occurrence } from "../../../../src/shared/calendar/types.ts";
import type { ClockPrefs } from "../../../../src/shared/time/clock.ts";
import { inkOn, tint } from "../colors.ts";
import { clockShort, titleOf } from "../format.ts";
import { occurrenceKey } from "../grid/event-block.tsx";
import { MONTH_CHIP_HEIGHT } from "../layout.ts";

export function EventChip({
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
  const common = {
    testID: `chip:${occurrenceKey(occurrence)}`,
    focusable: true,
    accessibilityRole: "button" as const,
    onPress: (info: { bounds?: Bounds }) => onPress(info.bounds),
    onPointer,
  };
  if (bar) {
    return (
      <View
        {...common}
        style={{
          height: MONTH_CHIP_HEIGHT - 1,
          flexShrink: 0,
          paddingHorizontal: 5,
          borderRadius: 4,
          justifyContent: "center",
          backgroundColor: color,
          borderWidth: selected ? 2 : 0,
          borderColor: colors.text,
          opacity: dragged ? 0.35 : 1,
          focusRingColor: colors.focusRing,
        }}
      >
        <Text numberOfLines={1} style={{ fontSize: 11, fontWeight: "semibold", color: inkOn(color) }}>
          {title}
        </Text>
      </View>
    );
  }
  return (
    <View
      {...common}
      style={{
        height: MONTH_CHIP_HEIGHT - 1,
        flexShrink: 0,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 3,
        borderRadius: 4,
        backgroundColor: selected ? tint(color, 0.3) : "#00000000",
        hoverBackgroundColor: tint(color, selected ? 0.36 : 0.18),
        opacity: dragged ? 0.35 : 1,
        focusRingColor: colors.focusRing,
      }}
    >
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color, flexShrink: 0 }} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 11, color: colors.text }}>
          {title}
        </Text>
      </View>
      {timed && (
        <View style={{ flexShrink: 0 }}>
          <Text numberOfLines={1} style={{ fontSize: 10, color: colors.textMuted }}>
            {clockShort(occurrence.start, prefs)}
          </Text>
        </View>
      )}
    </View>
  );
}

export function MoreChip({ count, onPress, testID }: { count: number; onPress: () => void; testID: string }) {
  const colors = useColors();
  return (
    <View
      testID={testID}
      onPress={onPress}
      style={{
        height: MONTH_CHIP_HEIGHT - 1,
        flexShrink: 0,
        paddingHorizontal: 5,
        justifyContent: "center",
        borderRadius: 4,
        hoverBackgroundColor: colors.button,
      }}
    >
      <Text numberOfLines={1} style={{ fontSize: 10, fontWeight: "semibold", color: colors.textMuted }}>{`${count} more`}</Text>
    </View>
  );
}
