/**
 * `--calendar`'s `--date-format`: strftime's conversions for a day, in the C
 * locale's names (Zenity passes the format to strftime). Without a format the
 * day prints as `%x` does in the US locale, 11/03/2026.
 */

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const pad = (n: number, width = 2, fill = "0"): string => String(n).padStart(width, fill);

/** Days since January 1st, from 1. */
function dayOfYear(year: number, month: number, day: number): number {
  return Math.round((Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 1)) / 86_400_000) + 1;
}

/** The day (year, month 1-12, day) in `format`. Time conversions print midnight; an unknown one prints as written. */
export function formatDate(format: string | null, year: number, month: number, day: number): string {
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const conversions: Record<string, () => string> = {
    a: () => (DAYS[weekday] as string).slice(0, 3),
    A: () => DAYS[weekday] as string,
    b: () => (MONTHS[month - 1] as string).slice(0, 3),
    h: () => (MONTHS[month - 1] as string).slice(0, 3),
    B: () => MONTHS[month - 1] as string,
    C: () => pad(Math.floor(year / 100)),
    d: () => pad(day),
    e: () => pad(day, 2, " "),
    D: () => `${pad(month)}/${pad(day)}/${pad(year % 100)}`,
    F: () => `${pad(year, 4)}-${pad(month)}-${pad(day)}`,
    j: () => pad(dayOfYear(year, month, day), 3),
    m: () => pad(month),
    u: () => String(weekday === 0 ? 7 : weekday),
    w: () => String(weekday),
    x: () => `${pad(month)}/${pad(day)}/${pad(year, 4)}`,
    y: () => pad(year % 100),
    Y: () => String(year),
    H: () => "00",
    I: () => "12",
    M: () => "00",
    S: () => "00",
    p: () => "AM",
    n: () => "\n",
    t: () => "\t",
    "%": () => "%",
  };
  return (format ?? "%x").replace(/%([a-zA-Z%])/g, (whole, code: string) => conversions[code]?.() ?? whole);
}

/** The days in a month (1-12). */
export function daysIn(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** A month's grid, six weeks from Sunday: each cell its day of the month, or null outside it. */
export function monthCells(year: number, month: number): (number | null)[] {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const count = daysIn(year, month);
  return Array.from({ length: 42 }, (_, index) => {
    const day = index - first + 1;
    return day >= 1 && day <= count ? day : null;
  });
}

/** The day `by` days from year, month, day (another month's when it crosses one). */
export function addDays(year: number, month: number, day: number, by: number): { year: number; month: number; day: number } {
  const date = new Date(Date.UTC(year, month - 1, day + by));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

export const MONTH_NAMES: readonly string[] = MONTHS;
export const WEEKDAY_LETTERS: readonly string[] = DAYS.map((name) => name.slice(0, 2));
