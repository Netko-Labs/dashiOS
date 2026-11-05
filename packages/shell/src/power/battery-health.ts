/**
 * Battery health (docs/0.4.0.html, Power E): where charging stops. The
 * charge limit (`charge_control_end_threshold`, through dashi-hardware's
 * `charge-limit` knob, for any vendor with the kernel interface), a one-time
 * full charge for a trip (back to the limit once the battery is full or the
 * cable comes out), and an optional schedule: full by a time on weekdays or
 * every day, charging past the limit in the hours before it. A machine
 * without the knob has none of it; with no limit chosen the firmware's own
 * stays.
 */

import type { PowerSection } from "./modes/settings.ts";

/** How long before `fullBy` charging goes past the limit: enough for most batteries from 80%. */
export const SCHEDULE_LEAD_MINUTES = 180;

export interface ChargeTarget {
  /** The limit to set, null to leave the firmware's. */
  percent: number | null;
  /** One line for the menu: "Charging stops at 80%". */
  why: string | null;
}

/** Minutes since midnight of "HH:MM". */
const minutesOf = (clock: string): number | null => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(clock);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};

/** Whether `now` is in the hours before the schedule's time on a day it runs. */
export function inScheduleWindow(settings: Pick<PowerSection, "fullBy" | "fullByDays">, now: Date): boolean {
  if (!settings.fullBy) return false;
  const at = minutesOf(settings.fullBy);
  if (at === null) return false;
  const minute = now.getHours() * 60 + now.getMinutes();
  const runsOn = (day: number) => (settings.fullByDays ?? "weekdays") === "daily" || (day >= 1 && day <= 5);
  // A time before 03:00 starts the evening before (01:00 starts at 22:00 the day before).
  const start = at - SCHEDULE_LEAD_MINUTES;
  if (start >= 0) return runsOn(now.getDay()) && minute >= start && minute < at;
  const tomorrow = (now.getDay() + 1) % 7;
  return (runsOn(now.getDay()) && minute < at) || (runsOn(tomorrow) && minute >= start + 24 * 60);
}

export function chargeTarget(settings: PowerSection, now: Date): ChargeTarget {
  const limit = settings.chargeLimit;
  if (settings.fullChargeOnce) return { percent: 100, why: "Charging to full once" };
  if (limit !== undefined && limit < 100 && inScheduleWindow(settings, now)) return { percent: 100, why: `Charging to full by ${settings.fullBy}` };
  if (limit === undefined) return { percent: null, why: null };
  return { percent: limit, why: limit >= 100 ? null : `Charging stops at ${limit}%` };
}

/** Whether a one-time full charge is over: the battery is full, or the cable came out after it began. */
export function fullChargeDone(source: { plugged: boolean; percent: number | null }, wasPlugged: boolean): boolean {
  return (source.percent !== null && source.percent >= 100) || (wasPlugged && !source.plugged);
}
