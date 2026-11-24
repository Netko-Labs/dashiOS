/**
 * The small month in the sidebar, and the event sheet's date picker: the
 * kit's one month grid (UI-14, `MonthGrid`) in the region's first day and
 * words, the main view's day chosen, today an ink disc, a dot under days with
 * events. ‹ › page through months without moving the main view.
 */

import { type Day as GridDay, MONTH_GRID, MonthGrid, SPACE, TYPE } from "@dashi/ui";
import { View } from "@mirinjs/metal";
import { useEffect, useState } from "react";
import { addDays, addMonths, type Day, firstOfMonth, monthOf, startOfWeek } from "../../../../src/shared/calendar/index.ts";
import type { ClockPrefs } from "../../../../src/shared/time/index.ts";

/** The most weeks a month spans. */
const WEEKS = 6;
/**
 * The grid's height with six weeks (its head, the weekdays' letters and the
 * days), kept whatever the month, so what is under it does not move from
 * month to month.
 */
export const MINI_MONTH_HEIGHT =
  MONTH_GRID.target + MONTH_GRID.headGap + TYPE.caption.line + MONTH_GRID.headGap + WEEKS * MONTH_GRID.cell + (WEEKS - 1) * MONTH_GRID.gap;

export interface MiniMonthProps {
  /** The day the main view is on: the chosen day. */
  anchor: Day;
  /** Today, an ink disc; none in the date picker. */
  today?: Day;
  firstDay: number;
  prefs: ClockPrefs;
  /** The days with events, for their dots. */
  busy: (from: Day, to: Day) => ReadonlySet<Day>;
  onPick: (day: Day) => void;
  /** Its test ids ("mini"; the event sheet's date picker has its own). */
  idPrefix?: string;
}

/** A `YYYY-MM-DD` day as the grid's. */
export function gridDay(day: Day): GridDay {
  // monthOf's month is 0–11, as the grid's is.
  const { year, month } = monthOf(day);
  return { year, month, date: Number(day.slice(8, 10)) };
}

/** The grid's day as a `YYYY-MM-DD` day. */
export const fromGridDay = ({ year, month, date }: GridDay): Day => `${year}-${String(month + 1).padStart(2, "0")}-${String(date).padStart(2, "0")}` as Day;

export function MiniMonth({ anchor, today, firstDay, prefs, busy, onPick, idPrefix = "mini" }: MiniMonthProps) {
  const [page, setPage] = useState<Day>(firstOfMonth(monthOf(anchor).year, monthOf(anchor).month));
  // The main view moved to another month: follow it.
  useEffect(() => {
    const { year, month } = monthOf(anchor);
    setPage(firstOfMonth(year, month));
  }, [anchor]);
  const { year, month } = monthOf(page);
  const first = startOfWeek(page, firstDay);
  const marked = busy(first, addDays(first, WEEKS * 7));
  return (
    <View testID={`${idPrefix}-month`} style={{ flexShrink: 0, minHeight: MINI_MONTH_HEIGHT, marginBottom: idPrefix === "mini" ? SPACE.inset : 0 }}>
      <MonthGrid
        testID={idPrefix}
        year={year}
        month={month}
        {...(today !== undefined ? { today: gridDay(today) } : {})}
        chosen={gridDay(anchor)}
        onChoose={(day) => onPick(fromGridDay(day))}
        onMonth={(by) => setPage(addMonths(page, by))}
        firstWeekday={firstDay}
        locale={prefs.locale}
        marked={marked as ReadonlySet<string>}
      />
    </View>
  );
}
