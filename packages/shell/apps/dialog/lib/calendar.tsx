/**
 * `--calendar`: the prompt and a month to pick a day in, on the kit's one
 * month grid (UI-14, `MonthGrid`): the region's first weekday and names,
 * today an ink disc, the chosen day on the selection wash. The arrows move a
 * week; ‹ and › a month. OK prints the day in `--date-format`
 * (date-format.ts), which is Zenity's and stays in the C locale.
 */

import { readFileSync } from "node:fs";
import { type Day, MonthGrid } from "@dashi/ui";
import { useState } from "react";
import { settingsPath } from "../../../src/shared/settings/index.ts";
import { clockPrefsFrom, firstDayIndex, readRegionSettings } from "../../../src/shared/time/index.ts";
import { addDays, daysIn, formatDate } from "./date-format.ts";
import { type Answer, DialogFrame, standardButtons } from "./frame.tsx";
import { Prompt } from "./prompt.tsx";
import type { CalendarSpec } from "./spec.ts";

/** The region the person chose in System Settings (the locale and first weekday the grid draws in); the process's own without one. */
export function dialogRegion(
  path: string = settingsPath(),
  env: Readonly<Record<string, string | undefined>> = process.env,
): { locale: string; firstDay: number } {
  let settings: Parameters<typeof clockPrefsFrom>[0] = { clock: {}, region: {} };
  try {
    settings = readRegionSettings(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    // No settings yet: the process's locale.
  }
  const clock = clockPrefsFrom(settings, env);
  return { locale: clock.locale, firstDay: firstDayIndex(clock.locale, clock.firstWeekday) };
}

/** A day of the grid's (month 0–11) from Zenity's (month 1–12), and back. */
const gridDay = (day: { year: number; month: number; day: number }): Day => ({ year: day.year, month: day.month - 1, date: day.day });
const zenityDay = (day: Day): { year: number; month: number; day: number } => ({ year: day.year, month: day.month + 1, day: day.date });

export function CalendarView({ spec, answer }: { spec: CalendarSpec; answer: Answer }) {
  const [region] = useState(() => dialogRegion());
  const [chosen, setChosen] = useState({ year: spec.year, month: spec.month, day: Math.min(spec.day, daysIn(spec.year, spec.month)) });
  const now = new Date();
  const page = (by: number): void =>
    setChosen((current) => {
      const month = current.month + by;
      const year = current.year + Math.floor((month - 1) / 12);
      const wrapped = ((((month - 1) % 12) + 12) % 12) + 1;
      return { year, month: wrapped, day: Math.min(current.day, daysIn(year, wrapped)) };
    });
  const ok = (): void => answer(0, `${formatDate(spec.dateFormat, chosen.year, chosen.month, chosen.day)}\n`);
  const buttons = standardButtons({ okLabel: spec.okLabel, cancelLabel: spec.cancelLabel, extraButtons: spec.extraButtons, answer, onOk: ok });
  return (
    <DialogFrame
      title={spec.title}
      buttons={buttons}
      onCancel={() => answer(1)}
      onKey={(key) => {
        if (key.kind === "up" || key.kind === "down") setChosen((current) => addDays(current.year, current.month, current.day, key.kind === "up" ? -7 : 7));
      }}
    >
      <Prompt text={spec.text} />
      <MonthGrid
        testID="dialog:month"
        year={chosen.year}
        month={chosen.month - 1}
        today={{ year: now.getFullYear(), month: now.getMonth(), date: now.getDate() }}
        chosen={gridDay(chosen)}
        onChoose={(day) => setChosen(zenityDay(day))}
        onMonth={page}
        firstWeekday={region.firstDay}
        locale={region.locale}
      />
    </DialogFrame>
  );
}
