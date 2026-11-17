/**
 * The widgets in words, for agents (`list_widgets`, notifications' scope: no
 * new consent): what each placed widget shows now, and what is on air. An
 * agent works for the person, so it is told what the area shows them.
 */

import { countdownText } from "../tally/index.ts";
import { widgetInfo } from "./catalog.ts";
import type { WidgetHub } from "./hub.ts";
import { clockText } from "./lib/data.ts";
import { positionAt } from "./lib/sources/media.ts";
import { timeLeft } from "./lib/sources/timer.ts";
import { weatherLook } from "./lib/sources/weather.ts";
import type { Placement } from "./types.ts";

export interface WidgetFacts {
  id: string;
  name: string;
  size: string;
  /** Its category's ink, or "plain". */
  ink: string;
  says: string;
}

function says(hub: WidgetHub, placement: Placement, now: number): string {
  switch (placement.kind) {
    case "weather": {
      const state = hub.weather.getSnapshot();
      if (state.status === "loading") return "looking";
      if (state.status === "down") return "Weather isn't answering";
      const { now: w } = state;
      return `${w.place}: ${w.temperature}°, ${weatherLook(w.code).words.toLowerCase()}, high ${w.high}°, low ${w.low}°${w.rainFrom ? `, rain from ${clockText(w.rainFrom, true)}` : ""}${state.status === "stale" ? " (stale)" : ""}`;
    }
    case "battery": {
      const battery = hub.system?.getSnapshot().battery;
      return battery ? `${battery.percent} %, ${battery.state}${battery.minutesLeft ? `, ${Math.round(battery.minutesLeft)} min` : ""}` : "no battery";
    }
    case "timer": {
      const timers = hub.timers.getSnapshot();
      return timers.length === 0
        ? "no timer"
        : timers.map((timer) => `${timer.label} ${countdownText(now + timeLeft(timer, now), now)}${timer.endsAt === null ? " (paused)" : ""}`).join("; ");
    }
    case "media": {
      const playing = hub.media.getSnapshot();
      return playing
        ? `${playing.playing ? "playing" : "paused"}: ${playing.title}${playing.artist ? ` by ${playing.artist}` : ""} at ${Math.round(positionAt(playing, now) / 1000)} s`
        : "nothing playing";
    }
    case "calendar":
    case "rundown":
      return (
        hub
          .rundown(now)
          .filter((row) => row.at >= now)
          .slice(0, 4)
          .map((row) => `${clockText(row.at, true)} ${row.title}`)
          .join("; ") || "nothing else today"
      );
    case "agents": {
      const working = (hub.runs?.getSnapshot() ?? []).filter((run) => run.ended === null);
      return working.length === 0 ? "nothing running" : working.map((run) => `${run.harnessName}: ${run.request.split("\n")[0]}`).join("; ");
    }
    default:
      return "";
  }
}

export function widgetFacts(
  hub: WidgetHub,
  now: number = Date.now(),
): { onAir: { label: string; reason: string } | null; standby: string[]; widgets: WidgetFacts[] } {
  const view = hub.tally.get();
  const extensions = hub.extensions.getSnapshot().map((each) => each.info);
  return {
    onAir: view.item ? { label: view.item.label, reason: view.item.reason } : null,
    standby: view.standby.map((item) => item.label),
    widgets: hub.store.getSnapshot().map((placement) => {
      const info = widgetInfo(placement.kind, extensions);
      return { id: placement.id, name: info?.name ?? placement.kind, size: placement.size, ink: info?.ink ?? "plain", says: says(hub, placement, now) };
    }),
  };
}
