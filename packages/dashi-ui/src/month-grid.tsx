/**
 * The one month grid (UI-14): Calendar's mini month, dashi-dialog's
 * --calendar and the notification centre's month card. The month 13
 * SemiBold with ‹ › as 24 targets (12 chevrons), the weekdays' letters 11
 * SemiBold muted from the region's first day, today an ink disc (never the
 * accent, CO-2), the chosen day the selection wash, days outside the month
 * sunk, a day with something on it marked with an ink dot. Each day is a
 * button named by its full date; the days are one Tab stop.
 */

import { Svg, Text, View } from "@mirinjs/metal";
import { useControlState } from "./control-state.tsx";
import { CHEVRON_LEFT, CHEVRON_RIGHT } from "./glyphs.ts";
import { type Day, dayKey, type GridDay, monthWeeks, sameDay, weekdayLetters } from "./month-math.ts";
import { CLEAR, pill, SPACE, TYPE, useColors, WEIGHT } from "./theme/index.ts";

/** Its measures: a day's cell, the ‹ › targets and chevrons, a day's dot, the gaps. */
export const MONTH_GRID = { cell: 24, target: 24, chevron: 12, dot: 4, gap: SPACE.xxs, headGap: SPACE.s } as const;

export interface MonthGridProps {
  year: number;
  /** 0 to 11. */
  month: number;
  today?: Day;
  chosen?: Day | null;
  onChoose?: (day: Day) => void;
  /** ‹ and ›: the month before (-1) or after (1). Without it, no arrows. */
  onMonth?: (by: -1 | 1) => void;
  /** 0 is Sunday, 1 Monday: the region's. */
  firstWeekday?: number;
  /** The region's locale, for the month's name and the weekdays' letters. */
  locale?: string;
  /** Days with something on them (`dayKey`s), marked with an ink dot. */
  marked?: ReadonlySet<string>;
  testID?: string;
}

export function MonthGrid({ year, month, today, chosen, onChoose, onMonth, firstWeekday = 0, locale, marked, testID = "month" }: MonthGridProps) {
  const colors = useColors();
  const title = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(new Date(year, month, 1));
  const full = new Intl.DateTimeFormat(locale, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  return (
    <View testID={testID} style={{ flexDirection: "column", gap: MONTH_GRID.headGap, alignSelf: "flex-start" }}>
      <View style={{ flexDirection: "row", alignItems: "center", height: MONTH_GRID.target }}>
        <View testID={`${testID}:title`} style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontSize: TYPE.body.size, fontWeight: WEIGHT.semibold, color: colors.text }}>
            {title}
          </Text>
        </View>
        {onMonth && <Arrow testID={`${testID}:previous`} glyph={CHEVRON_LEFT} label="Previous month" onPress={() => onMonth(-1)} />}
        {onMonth && <Arrow testID={`${testID}:next`} glyph={CHEVRON_RIGHT} label="Next month" onPress={() => onMonth(1)} />}
      </View>
      <View style={{ flexDirection: "row", gap: MONTH_GRID.gap }}>
        {weekdayLetters(firstWeekday, locale).map((letter, at) => (
          <View key={at} style={{ width: MONTH_GRID.cell, alignItems: "center" }}>
            <Text style={{ fontSize: TYPE.caption.size, fontWeight: WEIGHT.semibold, color: colors.textMuted }}>{letter}</Text>
          </View>
        ))}
      </View>
      <View focusGroup accessibilityRole="group" style={{ flexDirection: "column", gap: MONTH_GRID.gap }}>
        {monthWeeks(year, month, firstWeekday).map((week, row) => (
          // The weeks of a month never reorder.
          <View key={row} style={{ flexDirection: "row", gap: MONTH_GRID.gap }}>
            {week.map((day) => (
              <DayCell
                key={dayKey(day)}
                day={day}
                label={full.format(new Date(day.year, day.month, day.date))}
                today={sameDay(day, today)}
                chosen={sameDay(day, chosen)}
                marked={marked?.has(dayKey(day)) === true}
                testID={`${testID}:${dayKey(day)}`}
                {...(onChoose ? { onPress: () => onChoose(day) } : {})}
              />
            ))}
          </View>
        ))}
      </View>
    </View>
  );
}

function Arrow({ testID, glyph, label, onPress }: { testID: string; glyph: string; label: string; onPress: () => void }) {
  const colors = useColors();
  const state = useControlState();
  return (
    <View
      testID={testID}
      focusable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      onPointer={state.onPointer}
      style={{
        width: MONTH_GRID.target,
        height: MONTH_GRID.target,
        borderRadius: pill(MONTH_GRID.target),
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: state.pressed ? colors.pressed : CLEAR,
        hoverBackgroundColor: colors.button,
        focusRingColor: colors.focusRing,
      }}
    >
      <Svg markup={glyph} size={MONTH_GRID.chevron} color={colors.textMuted} />
    </View>
  );
}

function DayCell({
  day,
  label,
  today,
  chosen,
  marked,
  testID,
  onPress,
}: {
  day: GridDay;
  label: string;
  today: boolean;
  chosen: boolean;
  marked: boolean;
  testID: string;
  onPress?: () => void;
}) {
  const colors = useColors();
  const ground = today ? colors.primary : chosen ? colors.selectionWash : CLEAR;
  const ink = today ? colors.onPrimary : day.inMonth ? colors.text : colors.textDisabled;
  return (
    <View
      testID={testID}
      focusable={onPress !== undefined}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: chosen }}
      {...(onPress ? { onPress } : {})}
      style={{
        width: MONTH_GRID.cell,
        height: MONTH_GRID.cell,
        borderRadius: pill(MONTH_GRID.cell),
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
        backgroundColor: ground,
        hoverBackgroundColor: today || chosen || onPress === undefined ? ground : colors.button,
        focusRingColor: colors.focusRing,
      }}
    >
      <Text style={{ fontSize: TYPE.caption.size, fontWeight: today ? WEIGHT.semibold : WEIGHT.regular, color: ink }}>{String(day.date)}</Text>
      {marked && (
        <View
          style={{
            position: "absolute",
            bottom: SPACE.px,
            width: MONTH_GRID.dot,
            height: MONTH_GRID.dot,
            borderRadius: pill(MONTH_GRID.dot),
            backgroundColor: today ? colors.onPrimary : colors.text,
          }}
        />
      )}
    </View>
  );
}
