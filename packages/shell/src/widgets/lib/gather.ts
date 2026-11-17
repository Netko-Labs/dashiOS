/** The Rundown's facts from each source, as rows (lib/rundown.ts decides which show). */

import { instantOf, type Occurrence } from "../../shared/calendar/index.ts";
import type { Battery } from "../../system/index.ts";
import type { RundownRow } from "./rundown.ts";
import type { Timer } from "./sources/timer.ts";
import type { WeatherState } from "./sources/weather.ts";

export interface GatherInput {
  occurrences: readonly Occurrence[];
  timers: readonly Timer[];
  weather: WeatherState;
  runs: readonly { id: string; request: string; harnessName: string; ended: number | null }[];
  battery: Battery | null;
  now: number;
}

const ofDay = (at: number, now: number): boolean => new Date(at).toDateString() === new Date(now).toDateString();

export function gatherRundown({ occurrences, timers, weather, runs, battery, now }: GatherInput): RundownRow[] {
  const rows: RundownRow[] = [];
  for (const occurrence of occurrences) {
    if (occurrence.event.allDay) continue;
    const at = instantOf(occurrence.start).getTime();
    if (!ofDay(at, now)) continue;
    const place = occurrence.event.location.trim();
    rows.push({ at, title: occurrence.event.title || "Event", detail: place, source: "calendar", ink: "miso", glyph: "cal", private: true });
  }
  for (const timer of timers)
    if (timer.endsAt !== null && timer.endsAt > now)
      rows.push({ at: timer.endsAt, title: timer.label, detail: "timer ends", source: "timer", ink: "wakame", glyph: "timer", private: false });
  if ((weather.status === "ok" || weather.status === "stale") && weather.now.rainFrom !== null && weather.now.rainFrom > now)
    rows.push({ at: weather.now.rainFrom, title: "Rain", detail: "Take a coat", source: "weather", ink: "mizu", glyph: "rain", private: false });
  for (const run of runs)
    if (run.ended === null)
      rows.push({
        at: now,
        title: run.request.split("\n")[0]?.slice(0, 60) || "A task",
        detail: `${run.harnessName} runs it`,
        source: "agents",
        ink: "shiso",
        glyph: "spark",
        private: true,
      });
  if (battery?.state === "charging" && battery.minutesLeft !== undefined && battery.minutesLeft > 0)
    rows.push({
      at: now + battery.minutesLeft * 60_000,
      title: "Charged",
      detail: `${battery.percent} % now`,
      source: "battery",
      ink: "matcha",
      glyph: "bolt",
      private: false,
    });
  return rows.sort((a, b) => a.at - b.at);
}
