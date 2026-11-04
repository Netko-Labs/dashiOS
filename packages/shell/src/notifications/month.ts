/**
 * The month the notification center's calendar shows, as weeks of days
 * starting on the person's first day of the week. Pure: dates are local
 * calendar days, compared by year, month, and day.
 */

export interface Day {
  /** Day of the month, 1–31. */
  day: number;
  /** Whether it belongs to the month shown (the first and last weeks reach into the next and previous). */
  inMonth: boolean;
  today: boolean;
}

export interface MonthView {
  year: number;
  /** 0 January … 11 December. */
  month: number;
}

/** The month `offset` months from `view`. */
export function shiftMonth(view: MonthView, offset: number): MonthView {
  const index = view.year * 12 + view.month + offset;
  return { year: Math.floor(index / 12), month: ((index % 12) + 12) % 12 };
}

/**
 * Six weeks of days for `view`, each week starting on `firstDay` (0 Sunday …
 * 6 Saturday), so the grid never changes height from month to month.
 */
export function monthGrid(view: MonthView, firstDay: number, today: Date): Day[][] {
  const first = new Date(view.year, view.month, 1);
  const lead = (first.getDay() - firstDay + 7) % 7;
  const start = new Date(view.year, view.month, 1 - lead);
  return Array.from({ length: 6 }, (_, week) =>
    Array.from({ length: 7 }, (_, weekday) => {
      const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + week * 7 + weekday);
      return {
        day: date.getDate(),
        inMonth: date.getMonth() === view.month,
        today: date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth() && date.getDate() === today.getDate(),
      };
    }),
  );
}

/** "October 2026" in `locale`. */
export function monthTitle(view: MonthView, locale: string): string {
  const date = new Date(view.year, view.month, 1);
  try {
    return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(date);
  }
}
