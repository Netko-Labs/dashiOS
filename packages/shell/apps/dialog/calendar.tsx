/**
 * `--calendar`: the prompt and a month to pick a day in, the chosen day in
 * the accent and today ringed. The arrows move a week. OK prints the day in
 * `--date-format` (date-format.ts).
 */

import { useColors } from "@dashi/ui";
import { Svg, Text, View } from "@mirinjs/metal";
import { useState } from "react";
import { addDays, daysIn, formatDate, MONTH_NAMES, monthCells, WEEKDAY_LETTERS } from "./date-format.ts";
import { type Answer, DialogFrame, standardButtons } from "./frame.tsx";
import type { CalendarSpec } from "./spec.ts";

const CELL = 28;
const CHEVRON_LEFT =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M10 3.5L5.5 8l4.5 4.5" stroke="#000" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CHEVRON_RIGHT =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M6 3.5L10.5 8 6 12.5" stroke="#000" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';

interface Day {
  year: number;
  month: number;
  day: number;
}

export function CalendarDialog({ spec, answer }: { spec: CalendarSpec; answer: Answer }) {
  const colors = useColors();
  const [chosen, setChosen] = useState<Day>({ year: spec.year, month: spec.month, day: Math.min(spec.day, daysIn(spec.year, spec.month)) });
  const now = new Date();
  const today: Day = { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
  const same = (a: Day, b: Day): boolean => a.year === b.year && a.month === b.month && a.day === b.day;
  const page = (by: number): void =>
    setChosen((current) => {
      const month = current.month + by;
      const year = current.year + Math.floor((month - 1) / 12);
      const wrapped = ((((month - 1) % 12) + 12) % 12) + 1;
      return { year, month: wrapped, day: Math.min(current.day, daysIn(year, wrapped)) };
    });
  const ok = (): void => answer(0, `${formatDate(spec.dateFormat, chosen.year, chosen.month, chosen.day)}\n`);
  const buttons = standardButtons({ okLabel: spec.okLabel, cancelLabel: spec.cancelLabel, extraButtons: spec.extraButtons, answer, onOk: ok });
  const arrow = (markup: string, by: number, testID: string) => (
    <View
      testID={testID}
      onPress={() => page(by)}
      style={{ width: 24, height: 24, borderRadius: 6, alignItems: "center", justifyContent: "center", hoverBackgroundColor: colors.button }}
    >
      <Svg markup={markup} size={12} color={colors.textMuted} />
    </View>
  );
  const cells = monthCells(chosen.year, chosen.month);
  const weeks = Array.from({ length: 6 }, (_, week) => cells.slice(week * 7, week * 7 + 7));
  return (
    <DialogFrame
      title={spec.title}
      buttons={buttons}
      onCancel={() => answer(1)}
      onKey={(key) => {
        if (key.kind === "up" || key.kind === "down") setChosen((current) => addDays(current.year, current.month, current.day, key.kind === "up" ? -7 : 7));
      }}
    >
      {spec.text !== "" && (
        <View testID="dialog:text">
          <Text style={{ fontSize: 13, color: colors.text, lineHeight: 17 }}>{spec.text}</Text>
        </View>
      )}
      <View style={{ flexDirection: "column", alignSelf: "center", flexShrink: 0 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", height: 28, paddingLeft: 4 }}>
          <Text style={{ fontSize: 13, fontWeight: "semibold", color: colors.text }}>{`${MONTH_NAMES[chosen.month - 1]} ${chosen.year}`}</Text>
          <View style={{ flexDirection: "row" }}>
            {arrow(CHEVRON_LEFT, -1, "dialog:previous")}
            {arrow(CHEVRON_RIGHT, 1, "dialog:next")}
          </View>
        </View>
        <View style={{ flexDirection: "row", height: 20 }}>
          {WEEKDAY_LETTERS.map((letter) => (
            <View key={letter} style={{ width: CELL, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ fontSize: 11, color: colors.textMuted }}>{letter}</Text>
            </View>
          ))}
        </View>
        {weeks.map((week, row) => (
          <View key={row} style={{ flexDirection: "row", height: CELL }}>
            {week.map((day, column) => {
              if (day === null) return <View key={column} style={{ width: CELL }} />;
              const cell = { year: chosen.year, month: chosen.month, day };
              const picked = same(cell, chosen);
              return (
                <View
                  key={column}
                  testID={`dialog:day:${day}`}
                  onPress={() => setChosen(cell)}
                  style={{
                    width: CELL,
                    height: CELL,
                    borderRadius: CELL / 2,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: picked ? colors.selection : "#00000000",
                    hoverBackgroundColor: picked ? colors.selection : colors.button,
                    ...(same(cell, today) && !picked ? { borderWidth: 1, borderColor: colors.selection } : {}),
                  }}
                >
                  <Text style={{ fontSize: 12, fontWeight: picked ? "semibold" : "normal", color: picked ? "#ffffff" : colors.text }}>{String(day)}</Text>
                </View>
              );
            })}
          </View>
        ))}
      </View>
    </DialogFrame>
  );
}
