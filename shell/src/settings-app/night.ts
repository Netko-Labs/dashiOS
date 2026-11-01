/**
 * The pure side of the Night Shift controls: times of day as the pills show
 * them, the hours offered for a schedule, and the warmth scale. night-shift.ts
 * reads what these write (settings.json `nightShift`).
 */

import type { Range } from "./controls.ts";

/** Warmth in kelvin: left is warmest (1900, candlelight), right is daylight (6500, no tint). */
export const WARMTH: Range = { min: 1900, max: 6500, step: 100 };
/** What night-shift.ts uses when no warmth is saved. */
export const DEFAULT_WARMTH = 3400;
/** The schedule that "On" starts from. */
export const DEFAULT_SCHEDULE = { from: "21:00", to: "07:00" } as const;

/** Minutes since midnight from "H:MM" or "HH:MM"; null for anything else. */
export function minutesOf(text: string | undefined): number | null {
  const match = text === undefined ? null : /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(text);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** "21:00" for minutes since midnight, as written to the file. */
export function clockText(minutes: number): string {
  const whole = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
}

/** "9 PM", "7:30 AM", "12 AM" for minutes since midnight. */
export function clockLabel(minutes: number): string {
  const hour = Math.floor(minutes / 60) % 24;
  const minute = minutes % 60;
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}${minute === 0 ? "" : `:${String(minute).padStart(2, "0")}`} ${hour < 12 ? "AM" : "PM"}`;
}

const hours = (list: readonly number[]): number[] => list.map((hour) => hour * 60);

/** Evening hours the schedule may begin at, and morning hours it may end at. */
export const FROM_HOURS: readonly number[] = hours([18, 19, 20, 21, 22, 23, 0]);
export const TO_HOURS: readonly number[] = hours([4, 5, 6, 7, 8, 9]);

/** The pills for a time: the usual hours, plus the saved time when it is none of them (a hand-edited 21:30). */
export function timeChoices(usual: readonly number[], saved: number | null): Array<{ value: string; label: string }> {
  const all = saved !== null && !usual.includes(saved) ? [...usual, saved].sort((a, b) => a - b) : [...usual];
  return all.map((minutes) => ({ value: clockText(minutes), label: clockLabel(minutes) }));
}

/** "3400 K" with a word for how it looks. */
export function describeWarmth(kelvin: number): string {
  return `${kelvin} K`;
}

/** The schedule a pair of saved times makes, or null (it needs both). */
export function scheduleOf(from: string | undefined, to: string | undefined): { from: number; to: number } | null {
  const start = minutesOf(from);
  const end = minutesOf(to);
  return start !== null && end !== null ? { from: start, to: end } : null;
}
