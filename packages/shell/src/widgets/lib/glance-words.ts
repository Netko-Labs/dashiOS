/**
 * Today folded into words for Glance (LK-3, lock-v3 `c-glance`): the next event as a figure line ("5:00",
 * then "PM · Design review: glass"), and, within the hour and a half, the same event in words ("Design
 * review in 12 min"). Its title only where Today shows it (`todayEventsShown`, D820).
 */

import { instantOf, type Occurrence } from "../../shared/calendar/index.ts";
import { clockText } from "./data.ts";
import { inWords } from "./views/calendar.tsx";

/** Glance's next event: the figure, the words beside it, and how soon (null: not within the next 90 min). */
export interface GlanceNext {
  figure: string;
  words: string;
  soon: string | null;
}

/** Soon enough to say how soon (`inWords` counts minutes below this). */
const SOON_MS = 90 * 60_000;

/** The next event that hasn't started a minute ago, as Glance says it; null when there is none. */
export function glanceNext(occurrences: readonly Occurrence[], now: number, hour24: boolean, titled: boolean): GlanceNext | null {
  const next = occurrences.find((each) => !each.event.allDay && instantOf(each.start).getTime() + 60_000 > now);
  if (!next) return null;
  const at = instantOf(next.start).getTime();
  const mark = hour24 ? null : new Date(at).getHours() < 12 ? "AM" : "PM";
  const title = next.event.title.trim() || "Event";
  // "Design review: glass" is "Design review" in a line of facts, as the frame says it.
  const short = title.split(":")[0]?.trim() || title;
  return {
    figure: clockText(at, hour24),
    words: [mark, titled ? title : null].filter((part): part is string => part !== null).join(" · "),
    soon: at - now <= SOON_MS ? `${titled ? short : "Next event"} ${inWords(at, now)}` : null,
  };
}
