/**
 * A month as the grid draws it (UI-14): weeks from the region's first day,
 * each day knowing whether it belongs to the month shown. Pure, so the
 * calendar's arithmetic is tested apart from the drawing (month-grid.tsx).
 */

/** A day: its year, month (0 to 11) and date. */
export interface Day {
  year: number;
  month: number;
  date: number;
}

export interface GridDay extends Day {
  /** In the month shown, not the weeks around it. */
  inMonth: boolean;
}

export const sameDay = (a: Day | null | undefined, b: Day | null | undefined): boolean =>
  a != null && b != null && a.year === b.year && a.month === b.month && a.date === b.date;

/** A day as `YYYY-MM-DD`: a key that sorts. */
export const dayKey = ({ year, month, date }: Day): string => `${year}-${String(month + 1).padStart(2, "0")}-${String(date).padStart(2, "0")}`;

/** The month `by` months from `year`/`month`. */
export function addMonths(year: number, month: number, by: number): { year: number; month: number } {
  const at = new Date(year, month + by, 1);
  return { year: at.getFullYear(), month: at.getMonth() };
}

/**
 * The weeks that hold the month, each seven days from `firstWeekday` (0 is
 * Sunday, 1 Monday, as the region says): as many weeks as the month needs,
 * the days before and after it from the months around it.
 */
export function monthWeeks(year: number, month: number, firstWeekday = 0): GridDay[][] {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() - firstWeekday + 7) % 7;
  const length = new Date(year, month + 1, 0).getDate();
  const weeks = Math.ceil((lead + length) / 7);
  return Array.from({ length: weeks }, (_, week) =>
    Array.from({ length: 7 }, (_, column) => {
      const at = new Date(year, month, 1 - lead + week * 7 + column);
      return { year: at.getFullYear(), month: at.getMonth(), date: at.getDate(), inMonth: at.getMonth() === month };
    }),
  );
}

/** The weekdays' letters in the grid's order, from `firstWeekday`, in `locale` (the region's). */
export function weekdayLetters(firstWeekday = 0, locale?: string): string[] {
  const narrow = new Intl.DateTimeFormat(locale, { weekday: "narrow" });
  // 2023-01-01 was a Sunday.
  return Array.from({ length: 7 }, (_, at) => narrow.format(new Date(2023, 0, 1 + ((firstWeekday + at) % 7))));
}
