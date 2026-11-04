/**
 * How the notification center's month reaches the calendar: which days have
 * events (to mark with a dot) and opening Calendar on a day. The shell sets
 * the bridge when it starts the calendar service (index.ts); without it (a
 * test, a development run that starts nothing) the month is plain.
 */

import { useMemo, useSyncExternalStore } from "react";
import type { Day } from "../../apps/calendar/dates.ts";

export interface CalendarBridge {
  busyDays(from: Day, to: Day): Set<Day>;
  subscribe(listener: () => void): () => void;
  getVersion(): number;
  openDay(day: Day): void;
}

let current: CalendarBridge | null = null;

export function setCalendarBridge(bridge: CalendarBridge | null): void {
  current = bridge;
}

export const calendarBridge = (): CalendarBridge | null => current;

const NO_DAYS: ReadonlySet<Day> = new Set();
const never = (): (() => void) => () => {};

/** The days in [from, to) that have events, repainting when the calendars change. */
export function useBusyDays(from: Day, to: Day): ReadonlySet<Day> {
  const bridge = current;
  const version = useSyncExternalStore(bridge?.subscribe ?? never, bridge?.getVersion ?? (() => 0));
  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` is the bridge's change counter
  return useMemo(() => bridge?.busyDays(from, to) ?? NO_DAYS, [bridge, version, from, to]);
}
