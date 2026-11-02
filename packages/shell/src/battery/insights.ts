/**
 * What the battery monitor tells the person, in sentences: a draw well above
 * the usual one and what is behind it, the apps using significant energy, how
 * the discharge under way is going, what charging looks like, a worn battery,
 * a battery kept full all week, and Low Power when the charge is low. Pure:
 * everything comes in, the insights go out, warnings first.
 */

import type { BatteryState } from "../system/battery.ts";
import type { AppUse } from "./apps.ts";
import { averageWatts, currentDischarge, formatSpan, type Sample, typicalWatts } from "./history.ts";

export interface Insight {
  id: "faster" | "apps" | "discharge" | "charging" | "health" | "kept-full" | "low-power";
  tone: "warning" | "tip" | "info";
  title: string;
  detail: string;
}

export interface InsightInput {
  now: number;
  battery: { percent: number; state: BatteryState; minutesLeft?: number };
  /** Battery health in percent, null when the battery doesn't say. */
  health: number | null;
  /** The draw now, in watts. */
  watts: number | null;
  samples: readonly Sample[];
  /** The apps using significant energy, heaviest first. */
  apps: readonly AppUse[];
  /** Whether Low Power is on; null without power modes to choose from. */
  lowPower: boolean | null;
}

/** A draw this many times the usual one, and this many watts over it, is "faster than usual". */
const FASTER = { ratio: 1.4, watts: 2 } as const;
const LOW_POWER_BELOW = 30;
const WORN_BELOW = 80;

const names = (apps: readonly AppUse[]): string => {
  const shown = apps.slice(0, 3).map((app) => app.name);
  if (shown.length <= 1) return shown.join("");
  return `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}`;
};

export function insights(input: InsightInput): Insight[] {
  const { battery, samples, now, apps } = input;
  const out: Insight[] = [];
  const discharging = battery.state === "discharging";
  const recent = samples.filter((sample) => sample.t >= now - 10 * 60 && sample.state === "discharging");
  const lately = averageWatts(recent) ?? input.watts;
  const typical = typicalWatts(samples);

  if (discharging && lately !== null && typical !== null && lately >= typical * FASTER.ratio && lately - typical >= FASTER.watts) {
    out.push({
      id: "faster",
      tone: "warning",
      title: "Draining faster than usual",
      detail: `${lately.toFixed(1)} W over the last minutes; usually ${typical.toFixed(1)} W.${apps[0] ? ` ${apps[0].name} is using the most energy.` : ""}`,
    });
  }
  if (input.health !== null && input.health < WORN_BELOW) {
    out.push({
      id: "health",
      tone: "warning",
      title: `Battery health is ${input.health}%`,
      detail: "It holds noticeably less than when it was new, so a charge lasts less. A battery below 80% is often worth replacing.",
    });
  }
  if (discharging && battery.percent <= LOW_POWER_BELOW && input.lowPower === false) {
    out.push({
      id: "low-power",
      tone: "tip",
      title: "Turn on Low Power",
      detail: "The processor runs cooler and the battery lasts longer, at some cost in speed. Power Mode is below.",
    });
  }
  if (apps.length > 0) {
    out.push({
      id: "apps",
      tone: discharging ? "tip" : "info",
      title: "Using significant energy",
      detail: `${names(apps)} ${apps.length === 1 ? "has" : "have"} kept the processor busy for the last minutes${discharging ? "; quitting what you don't need makes the battery last longer" : ""}.`,
    });
  }
  const run = discharging ? currentDischarge(samples) : null;
  if (run) {
    const left = battery.minutesLeft === undefined ? "" : ` At this rate it lasts about ${formatSpan(battery.minutesLeft * 60)} more.`;
    out.push({
      id: "discharge",
      tone: "info",
      title: `On battery for ${formatSpan(now - run.since)}`,
      detail: `Used ${run.used}%${run.perHour === null ? "" : ` (${run.perHour}% an hour awake)`}.${left}`,
    });
  }
  if (battery.state === "charging") {
    const rate = input.watts === null ? "Charging" : `Charging at ${input.watts.toFixed(1)} W`;
    out.push({
      id: "charging",
      tone: "info",
      title: rate,
      detail: battery.minutesLeft === undefined ? "Working out how long until it's full." : `Full in about ${formatSpan(battery.minutesLeft * 60)}.`,
    });
  }
  // A week of samples, nearly all on power and full: a laptop that lives on its charger.
  const week = samples.filter((sample) => sample.t >= now - 7 * 24 * 3600);
  const kept = week.filter((sample) => sample.state !== "discharging" && sample.percent >= 95).length;
  if (week.length >= 24 * 60 && kept / week.length >= 0.8) {
    out.push({
      id: "kept-full",
      tone: "tip",
      title: "Mostly kept full",
      detail:
        "This computer spent most of the week plugged in at a full charge. Batteries kept at 100% wear faster; if yours supports a charge limit, 80% helps it last.",
    });
  }
  const order = { warning: 0, tip: 1, info: 2 } as const;
  return out.sort((a, b) => order[a.tone] - order[b.tone]);
}
