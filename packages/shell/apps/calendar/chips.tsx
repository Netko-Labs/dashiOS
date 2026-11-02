/** An event as a line in a month cell or the all-day strip: a solid bar for all-day events, a dot and the time for the rest. */

import { Text, View } from "@mirinjs/metal";
import type { ClockPrefs } from "../../src/clock.ts";
import { useColors } from "@dashi/ui";
import { inkOn, tint } from "./colors.ts";
import { dayPart } from "./dates.ts";
import { clockShort, titleOf } from "./format.ts";
import { MONTH_CHIP_HEIGHT } from "./layout.ts";
import type { Occurrence } from "./types.ts";

export function EventChip({
  occurrence,
  color,
  day,
  prefs,
  onOpen,
}: {
  occurrence: Occurrence;
  color: string;
  day: string;
  prefs: ClockPrefs;
  onOpen: (occurrence: Occurrence) => void;
}) {
  const colors = useColors();
  const { event } = occurrence;
  const title = titleOf(event);
  // A timed event that began on an earlier day is a bar on this one.
  const bar = event.allDay || dayPart(occurrence.start) < day;
  const testID = `chip:${occurrence.calendarId}:${event.uid}:${occurrence.start}`;
  if (bar) {
    return (
      <View
        testID={testID}
        onPress={() => onOpen(occurrence)}
        style={{ height: MONTH_CHIP_HEIGHT - 1, flexShrink: 0, paddingHorizontal: 5, borderRadius: 4, justifyContent: "center", backgroundColor: color }}
      >
        <Text numberOfLines={1} style={{ fontSize: 11, fontWeight: "semibold", color: inkOn(color) }}>
          {title}
        </Text>
      </View>
    );
  }
  return (
    <View
      testID={testID}
      onPress={() => onOpen(occurrence)}
      style={{
        height: MONTH_CHIP_HEIGHT - 1,
        flexShrink: 0,
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingHorizontal: 3,
        borderRadius: 4,
        hoverBackgroundColor: tint(color, 0.18),
      }}
    >
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color, flexShrink: 0 }} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 11, color: colors.text }}>
          {title}
        </Text>
      </View>
      <View style={{ flexShrink: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 10, color: colors.textMuted }}>
          {clockShort(occurrence.start, prefs)}
        </Text>
      </View>
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
      <Text style={{ fontSize: 10, fontWeight: "semibold", color: colors.textMuted }}>{`${count} more`}</Text>
    </View>
  );
}
