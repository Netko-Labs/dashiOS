/**
 * The Rundown's rows (round five, #17 and #24): the day's facts from every
 * source in time order, each in its source's ink, leaving out what a placed
 * widget already shows and never repeating its own hero. Pure: the view
 * draws what this returns.
 */

import type { InkName } from "@dashi/ui";
import type { GlyphName } from "../../shared/inks/index.ts";

export type RundownSource = "calendar" | "timer" | "weather" | "agents" | "battery";

export interface RundownRow {
  at: number;
  title: string;
  detail: string;
  source: RundownSource;
  ink: InkName;
  glyph: GlyphName;
  /** The title is the person's (an event): a blank on the lock screen. */
  private: boolean;
}

export interface RundownHero {
  /** The big number and its unit: "58" "min". */
  value: string;
  unit: string;
  title: string;
  detail: string;
  ink: InkName | null;
  /** 0–1: how near it is (the number's weight). */
  near: number;
  /** The row it stands for, left out of the list. */
  row: RundownRow | null;
  private: boolean;
}

/** Which source a placed kind already shows. */
const SHOWN_BY: Partial<Record<string, RundownSource>> = { calendar: "calendar", weather: "weather", battery: "battery", timer: "timer", agents: "agents" };

/** The hero: the next timed thing within the day, in minutes; else the time of day. */
export function rundownHero(rows: readonly RundownRow[], now: number, clock: (at: number) => string): RundownHero {
  const next = rows.find((row) => row.at > now && row.source === "calendar") ?? rows.find((row) => row.at > now) ?? null;
  if (!next) return { value: clock(now), unit: "", title: "Nothing else today", detail: "", ink: null, near: 0, row: null, private: false };
  const minutes = Math.max(1, Math.round((next.at - now) / 60_000));
  const long = minutes >= 100;
  return {
    value: long ? String(Math.round(minutes / 60)) : String(minutes),
    unit: long ? "h" : "min",
    title: `to ${next.title}`,
    detail: [clock(next.at), next.detail].filter(Boolean).join(" · "),
    ink: next.ink,
    near: 1 - Math.min(60, minutes) / 60,
    row: next,
    private: next.private,
  };
}

/** The list under the hero: in time order, from now on, without what a placed widget shows and without the hero, at most `max`. */
export function rundownRows(rows: readonly RundownRow[], placedKinds: readonly string[], hero: RundownHero, now: number, max: number): RundownRow[] {
  const shown = new Set(placedKinds.map((kind) => SHOWN_BY[kind]).filter((source) => source !== undefined));
  return [...rows]
    .filter((row) => row.at >= now - 5 * 60_000 && row !== hero.row && !shown.has(row.source))
    .sort((a, b) => a.at - b.at)
    .slice(0, max);
}
