/**
 * The battery over time: a sample a minute (the charge, what it was doing,
 * and the draw), kept for a week. Everything the monitor tells the person
 * (the charts, "since unplugged", what is usual) is read from these, by the
 * pure functions here; file.ts keeps them on disk.
 */

import { isRecord } from "@dashi/shape";
import type { BatteryState, PowerSupply } from "../system/battery.ts";

export interface Sample {
  /** Seconds since the epoch. */
  t: number;
  percent: number;
  state: BatteryState;
  /** Watts flowing out of the battery (discharging) or into it (charging); null when it doesn't say. */
  watts: number | null;
}

/** How long samples are kept. */
export const KEEP_SECONDS = 7 * 24 * 3600;
/** A gap longer than this between samples is the machine asleep or off, not time on battery. */
export const GAP_SECONDS = 10 * 60;

const amount = (text: string | null | undefined): number | null => (text && /^-?\d+$/.test(text) ? Math.abs(Number(text)) : null);

/**
 * The batteries' draw in watts: their power (µW) when they report it, else
 * current (µA) × voltage (µV). Null when none says; 0 is a battery at rest.
 */
export function drawWatts(supplies: readonly PowerSupply[]): number | null {
  const batteries = supplies.filter((supply) => supply.type === "Battery" && supply.scope !== "Device" && supply.present !== "0");
  let total = 0;
  let known = false;
  for (const battery of batteries) {
    const power = amount(battery.powerNow);
    const current = amount(battery.currentNow);
    const voltage = amount(battery.voltageNow);
    const watts = power !== null ? power / 1e6 : current !== null && voltage !== null ? (current * voltage) / 1e12 : null;
    if (watts === null) continue;
    total += watts;
    known = true;
  }
  return known ? Math.round(total * 100) / 100 : null;
}

/** `samples` without the ones older than `KEEP_SECONDS` before `now`. */
export function prune(samples: readonly Sample[], now: number): Sample[] {
  return samples.filter((sample) => sample.t >= now - KEEP_SECONDS && sample.t <= now + 60);
}

/**
 * The samples since the battery was last unplugged, oldest first: the run of
 * discharging samples that ends with the newest one (sleep gaps included, as
 * the charge went down across them too). Empty while on power.
 */
export function sinceUnplugged(samples: readonly Sample[]): Sample[] {
  const run: Sample[] = [];
  for (let index = samples.length - 1; index >= 0; index--) {
    const sample = samples[index] as Sample;
    if (sample.state !== "discharging") break;
    run.unshift(sample);
  }
  return run;
}

/** Seconds of these samples' time awake: gaps longer than `GAP_SECONDS` don't count. */
export function awakeSeconds(samples: readonly Sample[]): number {
  let seconds = 0;
  for (let index = 1; index < samples.length; index++) {
    const step = (samples[index] as Sample).t - (samples[index - 1] as Sample).t;
    if (step > 0 && step <= GAP_SECONDS) seconds += step;
  }
  return seconds;
}

/** The mean draw over these samples, in watts; null when none says. */
export function averageWatts(samples: readonly Sample[]): number | null {
  const known = samples.flatMap((sample) => (sample.watts === null ? [] : [sample.watts]));
  if (known.length === 0) return null;
  return Math.round((known.reduce((sum, watts) => sum + watts, 0) / known.length) * 10) / 10;
}

/** What a usual discharge draws: the median of every discharging sample's draw in the week, null with too few to say (an hour's worth). */
export function typicalWatts(samples: readonly Sample[]): number | null {
  const draws = samples
    .flatMap((sample) => (sample.state === "discharging" && sample.watts !== null && sample.watts > 0 ? [sample.watts] : []))
    .sort((a, b) => a - b);
  if (draws.length < 60) return null;
  const middle = Math.floor(draws.length / 2);
  const median = draws.length % 2 ? (draws[middle] as number) : ((draws[middle - 1] as number) + (draws[middle] as number)) / 2;
  return Math.round(median * 10) / 10;
}

export interface Discharge {
  /** When it was unplugged (the run's first sample). */
  since: number;
  /** Percent used since then (0 or more). */
  used: number;
  /** Percent an hour awake, null with under ten minutes to go on. */
  perHour: number | null;
  awake: number;
}

/** The discharge under way: since when, how much, how fast; null while on power. */
export function currentDischarge(samples: readonly Sample[]): Discharge | null {
  const run = sinceUnplugged(samples);
  const first = run[0];
  const last = run.at(-1);
  if (!first || !last) return null;
  const used = Math.max(first.percent - last.percent, 0);
  const awake = awakeSeconds(run);
  return { since: first.t, used, perHour: awake >= 600 ? Math.round((used / awake) * 3600 * 10) / 10 : null, awake };
}

/** One point per `bucket` seconds over the `span` before `now` (oldest first): the bucket's last sample, null where there is none. */
export function series(samples: readonly Sample[], now: number, span = 24 * 3600, bucket = 15 * 60): (Sample | null)[] {
  const count = Math.ceil(span / bucket);
  const points: (Sample | null)[] = Array.from({ length: count }, () => null);
  for (const sample of samples) {
    const at = Math.floor((sample.t - (now - span)) / bucket);
    if (at >= 0 && at < count) points[at] = sample;
  }
  return points;
}

/** "2 h 05 min", "45 min": a span for the person. */
export function formatSpan(seconds: number): string {
  const minutes = Math.max(Math.round(seconds / 60), 0);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;
}

/** Parses one stored line; null for anything that isn't a sample. */
export function parseSample(line: string): Sample | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  const { t, percent, state, watts } = value;
  if (typeof t !== "number" || !Number.isFinite(t) || typeof percent !== "number" || percent < 0 || percent > 100) return null;
  if (state !== "charging" && state !== "discharging" && state !== "full" && state !== "plugged") return null;
  if (watts !== null && (typeof watts !== "number" || !Number.isFinite(watts) || watts < 0 || watts > 500)) return null;
  return { t, percent, state, watts };
}
