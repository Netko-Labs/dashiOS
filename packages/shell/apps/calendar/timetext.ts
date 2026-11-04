/** Times and days typed into the event sheet's fields. */

import { isDay } from "./dates.ts";

/**
 * A time typed as people write it: "14:30", "2:30 pm", "2pm", "930", "9.30 a.m." → minutes after midnight, or null.
 * A bare hour or a 12-hour time without AM/PM is read as written ("9" is 9:00, "9:30" is 9:30; use 24-hour or pm for the afternoon).
 */
export function parseTimeText(text: string): number | null {
  const match = /^\s*(\d{1,2})(?:[:.]?(\d{2}))?\s*([ap])?\.?\s*(?:m\.?)?\s*$/i.exec(text.replace(/ /g, " "));
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = match[2] === undefined ? 0 : Number(match[2]);
  const meridiem = match[3]?.toLowerCase();
  if (minute > 59) return null;
  if (meridiem !== undefined) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (meridiem === "p" ? 12 : 0);
  } else if (hour > 23) return null;
  return hour * 60 + minute;
}

/** A day typed as 2026-11-05 (also 2026/11/05 and 2026.11.05), or null. */
export function parseDayText(text: string): string | null {
  const match = /^\s*(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\s*$/.exec(text);
  if (!match) return null;
  const day = `${match[1]}-${String(match[2]).padStart(2, "0")}-${String(match[3]).padStart(2, "0")}`;
  return isDay(day) ? day : null;
}
