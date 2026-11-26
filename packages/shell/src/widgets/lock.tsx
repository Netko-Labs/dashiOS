/**
 * The lock's clock as the widgets know it (the lock screen and Glance: @dashi/ui's split, D803, D806): the
 * time in the Inks' way, and whether this session's hosts draw its Inter Display ExtraLight. Today, the
 * lock's widgets, notifications and song, is lock-today.tsx.
 */

import { useHostAbilities } from "../shared/metal/index.ts";
import { clockText } from "./lib/data.ts";
import { printsDisplay } from "./lib/numerals.ts";

/** The time on the lock's clock: the hours two digits in 24-hour time ("09:05"), as the Inks draw it. */
export function lockTime(now: number, hour24: boolean): string {
  const [hours = "", minutes = ""] = clockText(now, hour24).split(":");
  return `${hour24 ? hours.padStart(2, "0") : hours}:${minutes}`;
}

/** Whether this session's hosts draw the clock's Inter Display ExtraLight (else it is Regular). */
export function useClockDisplay(): boolean {
  return printsDisplay(useHostAbilities());
}
