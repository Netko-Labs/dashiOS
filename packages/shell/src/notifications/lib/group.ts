/**
 * What the notification center shows, as plain data: the history grouped by
 * app, newest first, and the short times beside each notification.
 */

import type { HistoryEntry, Notification } from "../types.ts";

export interface NotificationGroup {
  /** Stable across renders: what the center remembers an expanded group by. */
  key: string;
  /** The app's name as its newest notification gave it. */
  name: string;
  /** Newest first; never empty. */
  entries: readonly HistoryEntry[];
}

/**
 * Which app a notification is from. Apps name themselves in `app_name`; a
 * client that sent none is told apart by its `desktop-entry`, and one that
 * sent neither shares the nameless group.
 */
export function appKey(notification: Pick<Notification, "appName" | "desktopEntry">): string {
  return (notification.appName.trim() || notification.desktopEntry).toLowerCase();
}

/** The name shown above an app's notifications. */
export function appLabel(notification: Pick<Notification, "appName" | "desktopEntry">): string {
  return notification.appName.trim() || notification.desktopEntry || "Notifications";
}

/**
 * The history (oldest first, as the store keeps it) as groups: the app with
 * the newest notification first, and each group's notifications newest first.
 */
export function groupByApp(history: readonly HistoryEntry[]): NotificationGroup[] {
  const groups = new Map<string, HistoryEntry[]>();
  for (const entry of [...history].reverse()) {
    const key = appKey(entry);
    const group = groups.get(key);
    if (group) group.push(entry);
    else groups.set(key, [entry]);
  }
  return [...groups].map(([key, entries]) => ({ key, name: appLabel(entries[0] as HistoryEntry), entries }));
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
// Built per time zone, not once: the shell follows a time zone change by
// setting TZ, and a formatter made earlier keeps the zone it was made in.
const formatters = new Map<string, Intl.DateTimeFormat>();
function format(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${process.env.TZ ?? ""}|${JSON.stringify(options)}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", options);
    formatters.set(key, formatter);
  }
  return formatter;
}
const WEEKDAY = { weekday: "short" } as const;
const MONTH_DAY = { month: "short", day: "numeric" } as const;
const MONTH_DAY_YEAR = { month: "short", day: "numeric", year: "numeric" } as const;

/** Calendar days between two dates in local time, whatever the hour or a clock change in between. */
function daysApart(from: Date, to: Date): number {
  const midnight = (date: Date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((midnight(to) - midnight(from)) / 86_400_000);
}

/**
 * How long ago, in the center's short form: "now" for the first minute,
 * "5m", "2h" up to a day, then "Yesterday", the weekday for the rest of the
 * week, and the date after that. A time from the future (a clock that was
 * set back) reads "now".
 */
export function relativeTime(then: number, now: number): string {
  const elapsed = now - then;
  if (elapsed < MINUTE) return "now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m`;
  if (elapsed < 24 * HOUR) return `${Math.floor(elapsed / HOUR)}h`;
  const past = new Date(then);
  const today = new Date(now);
  const days = daysApart(past, today);
  if (days <= 1) return "Yesterday";
  if (days < 7) return format(WEEKDAY).format(past);
  return format(past.getFullYear() === today.getFullYear() ? MONTH_DAY : MONTH_DAY_YEAR).format(past);
}

const HEADER_DATE = { weekday: "long", month: "long", day: "numeric" } as const;

/** The center's heading: "Friday, October 30". */
export function dateHeading(date: Date): string {
  return format(HEADER_DATE).format(date);
}
