/**
 * The calendar at the top of the notification center, as macOS shows one:
 * this month, today circled, the week starting on the person's first day
 * (Language & Region). The arrows page through months; the title brings
 * this month back.
 */

import { Svg, Text, View } from "@mirinjs/metal";
import { useState } from "react";
import { addDays, firstOfMonth, startOfWeek } from "../../apps/calendar/dates.ts";
import { calendarBridge, useBusyDays } from "../calendar/bridge.ts";
import { useClockPrefs } from "../clock.ts";
import { CHEVRON_LEFT, CHEVRON_RIGHT } from "../control-center/glyphs.ts";
import { firstDayIndex, weekdayNames } from "../region/week.ts";
import { useColors } from "@dashi/ui";
import { type MonthView, monthGrid, monthTitle, shiftMonth } from "./month.ts";

const CELL = { height: 26, dot: 24 } as const;

/**
 * `onOpenDay` is called with a day ("2026-11-05") when it is clicked, once Calendar is there to show it
 * (calendar/); days with events carry a dot.
 */
export function MonthCard({ now, onOpenDay }: { now: Date; onOpenDay?: (day: string) => void }) {
  const colors = useColors();
  const prefs = useClockPrefs();
  const current: MonthView = { year: now.getFullYear(), month: now.getMonth() };
  const [view, setView] = useState<MonthView>(current);
  const firstDay = firstDayIndex(prefs.locale, prefs.firstWeekday);
  const names = weekdayNames(prefs.locale, firstDay);
  const weeks = monthGrid(view, firstDay, now);
  const start = startOfWeek(firstOfMonth(view.year, view.month), firstDay);
  const busy = useBusyDays(start, addDays(start, weeks.length * 7));
  const clickable = onOpenDay !== undefined && calendarBridge() !== null;
  const isCurrent = view.year === current.year && view.month === current.month;

  const arrow = (markup: string, offset: number, testID: string) => (
    <View
      testID={testID}
      onPress={() => setView((shown) => shiftMonth(shown, offset))}
      style={{ width: 24, height: 24, borderRadius: 6, alignItems: "center", justifyContent: "center" }}
    >
      <Svg markup={markup} size={12} color={colors.textMuted} />
    </View>
  );

  return (
    <View testID="nc-month" style={{ flexDirection: "column", gap: 4, padding: 10, borderRadius: 14, backgroundColor: colors.tile, flexShrink: 0 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", height: 24, paddingLeft: 4 }}>
        <View testID="nc-month-title" onPress={() => setView(current)}>
          <Text style={{ fontSize: 13, fontWeight: "semibold", color: isCurrent ? colors.text : colors.selection }}>{monthTitle(view, prefs.locale)}</Text>
        </View>
        <View style={{ flexDirection: "row", gap: 2 }}>
          {arrow(CHEVRON_LEFT, -1, "nc-month-previous")}
          {arrow(CHEVRON_RIGHT, 1, "nc-month-next")}
        </View>
      </View>
      <View style={{ flexDirection: "row" }}>
        {names.map((name) => (
          <View key={name} style={{ flex: 1, alignItems: "center" }}>
            <Text style={{ fontSize: 10, fontWeight: "semibold", color: colors.textMuted }}>{name.slice(0, 2)}</Text>
          </View>
        ))}
      </View>
      {weeks.map((week, row) => (
        <View key={row} style={{ flexDirection: "row", height: CELL.height }}>
          {week.map((day, column) => {
            const key = addDays(start, row * 7 + column);
            return (
              <View
                key={column}
                testID={`nc-day:${key}`}
                onPress={clickable ? () => onOpenDay?.(key) : undefined}
                style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
              >
                <View
                  style={{
                    width: CELL.dot,
                    height: CELL.dot,
                    borderRadius: CELL.dot / 2,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: day.today ? colors.selection : "#00000000",
                    hoverBackgroundColor: day.today || !clickable ? undefined : colors.button,
                  }}
                >
                  <Text
                    style={{
                      fontSize: 12,
                      fontWeight: day.today ? "bold" : "normal",
                      color: day.today ? "#ffffff" : day.inMonth ? colors.text : colors.textMuted,
                      opacity: day.inMonth || day.today ? 1 : 0.5,
                    }}
                  >
                    {String(day.day)}
                  </Text>
                  {busy.has(key) && (
                    <View
                      testID={`nc-dot:${key}`}
                      style={{
                        position: "absolute",
                        bottom: 1,
                        width: 4,
                        height: 4,
                        borderRadius: 2,
                        backgroundColor: day.today ? "#ffffff" : colors.selection,
                        opacity: day.inMonth || day.today ? 1 : 0.5,
                      }}
                    />
                  )}
                </View>
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}
