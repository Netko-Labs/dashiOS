/** One event as an .ics file of its own (its calendar's name, colour and zones): what delete_event leaves in the Trash, which Calendar imports back. */

import { writeIcs } from "./lib/ics-write.ts";
import type { CalEvent, Calendar } from "./types.ts";

export function eventIcs(calendar: Calendar, event: CalEvent): string {
  return writeIcs({ events: [event], headerExtra: [], preserved: [], timezones: calendar.timezones, name: calendar.name, color: calendar.color });
}
