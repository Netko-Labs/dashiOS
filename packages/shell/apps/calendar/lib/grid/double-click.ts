/**
 * A second click on the same day or half hour soon after the first: the
 * grid makes an event there.
 */

import { useRef } from "react";
import type { Day } from "../../../../src/shared/calendar/index.ts";

/** How soon a second click on the same day or half hour makes an event there. */
export const DOUBLE_CLICK_MS = 450;

/** Notes a click; true when it is the second of a double click. */
export function useDoubleClick(): (day: Day, minutes: number | null) => boolean {
  const last = useRef<{ day: Day; minutes: number | null; at: number } | null>(null);
  return (day, minutes) => {
    const now = Date.now();
    const before = last.current;
    if (before && before.day === day && before.minutes === minutes && now - before.at < DOUBLE_CLICK_MS) {
      last.current = null;
      return true;
    }
    last.current = { day, minutes, at: now };
    return false;
  };
}
