/**
 * What each source puts on air, as the tally's items (tally/types.ts): pure
 * functions from a source's state and the time, so the rules can be tested.
 */

import type { Occurrence } from "../../shared/calendar/index.ts";
import { instantOf } from "../../shared/calendar/index.ts";
import type { PillAsk } from "../../shared/pill/index.ts";
import type { OnAirItem } from "../../tally/index.ts";
import type { Playing } from "./sources/media.ts";

/** An event is due from 5 minutes before it starts until it starts (round three's rule 2). */
export const EVENT_DUE_MS = 5 * 60_000;

export function eventsOnAir(occurrences: readonly Occurrence[], now: number): OnAirItem[] {
  return occurrences.flatMap((occurrence) => {
    if (occurrence.event.allDay) return [];
    const start = instantOf(occurrence.start).getTime();
    if (now < start - EVENT_DUE_MS || now >= start) return [];
    return [
      {
        key: `event:${occurrence.event.uid}:${occurrence.start}`,
        reason: "due",
        since: start - EVENT_DUE_MS,
        deadline: start,
        label: occurrence.event.title || "Event",
        glyph: "cal",
        ink: "miso",
      },
    ];
  });
}

export function mediaOnAir(playing: Playing | null): OnAirItem[] {
  if (!playing?.playing) return [];
  return [{ key: `media:${playing.player}`, reason: "running", since: playing.since, label: playing.title, glyph: "music", ink: "album" }];
}

/** What an agent's run puts on air: running while it works; asking only for a sign-in (a secret). */
export function runsOnAir(
  runs: readonly { id: string; harnessName: string; started: number; ended: number | null; question: { kind: string; title: string } | null }[],
  now: number,
): OnAirItem[] {
  return runs.flatMap((run): OnAirItem[] => {
    if (run.ended !== null) return [];
    const base = { key: `run:${run.id}`, glyph: "spark", ink: "shiso" as const };
    if (run.question?.kind === "sign-in") return [{ ...base, reason: "asks", critical: true, since: now, label: `${run.harnessName} asks` }];
    return [{ ...base, reason: "running", since: run.started, label: run.harnessName }];
  });
}

/** Dashi's own asks: only a critical one asks; the rest wait in their card (D402). */
export function asksOnAir(asks: readonly PillAsk[]): OnAirItem[] {
  return asks.map((ask) => ({
    key: `ask:${ask.id}`,
    reason: ask.critical ? "asks" : "running",
    critical: ask.critical === true,
    since: ask.since,
    label: "Dashi asks",
    glyph: "spark",
    ink: "shiso",
  }));
}
