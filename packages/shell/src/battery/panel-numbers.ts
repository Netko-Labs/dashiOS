/**
 * The battery panel's numbers (docs/design.html, "The battery"), pure: what
 * the status line says, how long to the charge limit, and where the watts go
 * in rows that add up. Every figure comes from something measured (the
 * battery's draw, its history, the apps' processor time, the adapter's
 * power_supply entry); a figure that isn't known leaves its row out.
 *
 * On battery the total is the battery's draw. The apps' share of it is an
 * estimate, said so in docs: what the machine draws above its usual floor
 * (the lowest tenth of the week's draws on battery, so the screen and the
 * idle machine stay in "everything else") split by the apps' share of the
 * processor time Dashi measured. Rounded down to tenths, so the apps and
 * "Screen and everything else" add up to the total exactly.
 *
 * Charging, the battery says what goes in; the adapter's own draw is known
 * only when its power_supply entry reports it (a USB-C source may), and then
 * "Running the laptop" is the difference.
 */

import type { Battery, PowerSupply } from "../system/battery.ts";
import { formatSpan, type Sample } from "./history.ts";
import type { AppUse } from "./lib/apps.ts";

/** The time until the battery reaches `limit` while charging, in minutes; null when it can't be timed or is past it. */
export function minutesToLimit(battery: Battery, limit: number | null): number | null {
  if (battery.state !== "charging" || battery.minutesLeft === undefined) return null;
  const target = limit === null ? 100 : Math.min(limit, 100);
  if (battery.percent >= target) return null;
  if (target >= 100 || battery.percent >= 100) return battery.minutesLeft;
  // minutesLeft is (full − now) at the present rate; the limit is the same rate over (limit − now).
  return Math.round((battery.minutesLeft * (target - battery.percent)) / (100 - battery.percent));
}

const span = (minutes: number): string => formatSpan(minutes * 60);

/** The battery row's time: "5 h 10 min" left, "16 min to 80%"; null when there is none to say. */
export function batteryTime(battery: Battery, limit: number | null): string | null {
  if (battery.state === "discharging") return battery.minutesLeft === undefined ? null : span(battery.minutesLeft);
  if (battery.state === "charging") {
    const minutes = minutesToLimit(battery, limit);
    if (minutes === null) return null;
    return limit !== null && limit < 100 ? `${span(minutes)} to ${limit}%` : `${span(minutes)} to full`;
  }
  return null;
}

/** The panel's status line, beside the charge. */
export function statusLine(battery: Battery, limit: number | null): string {
  switch (battery.state) {
    case "discharging":
      return battery.minutesLeft === undefined ? "On battery" : `On battery · ${span(battery.minutesLeft)} left`;
    case "charging": {
      const minutes = minutesToLimit(battery, limit);
      if (minutes === null) return "Charging";
      return limit !== null && limit < 100 ? `Charging · ${span(minutes)} to ${limit}%` : `Charging · ${span(minutes)} to full`;
    }
    case "full":
      return "Fully charged";
    case "plugged":
      return limit !== null && limit < 100 && battery.percent >= limit - 1 ? `Held at the ${limit}% limit` : "Not charging";
  }
}

/**
 * The machine's floor on battery: the lowest tenth of the week's draws while
 * discharging. Null with under an hour of them to go on.
 */
export function idleFloor(samples: readonly Sample[]): number | null {
  const draws = samples
    .flatMap((sample) => (sample.state === "discharging" && sample.watts !== null && sample.watts > 0 ? [sample.watts] : []))
    .sort((a, b) => a - b);
  if (draws.length < 60) return null;
  return draws[Math.floor(draws.length / 10)] as number;
}

/** The adapter as power_supply says: its rating (voltage_max × current_max) and what it draws now; null each when not reported. */
export interface Adapter {
  rating: number | null;
  input: number | null;
}

const amount = (text: string | null | undefined): number | null => (text && /^\d+$/.test(text) ? Number(text) : null);

/** The online charger's rating and draw, from its power_supply entry (a USB-C source reports them; a barrel jack's "Mains" usually doesn't). */
export function adapterOf(supplies: readonly PowerSupply[]): Adapter {
  const chargers = supplies.filter(
    (supply) => supply.online === "1" && supply.scope !== "Device" && (supply.type === "Mains" || (supply.type?.startsWith("USB") ?? false)),
  );
  let rating: number | null = null;
  let input: number | null = null;
  for (const charger of chargers) {
    const volts = amount(charger.voltageMax);
    const amps = amount(charger.currentMax);
    if (volts !== null && amps !== null && volts > 0 && amps > 0) rating = Math.max(rating ?? 0, Math.round((volts * amps) / 1e12));
    const power = amount(charger.powerNow);
    const current = amount(charger.currentNow);
    const voltage = amount(charger.voltageNow);
    const watts = power !== null ? power / 1e6 : current !== null && voltage !== null ? (current * voltage) / 1e12 : null;
    if (watts !== null && watts > 0) input = (input ?? 0) + watts;
  }
  return { rating: rating !== null && rating > 0 ? rating : null, input: input === null ? null : Math.round(input * 10) / 10 };
}

export interface PowerRow {
  /** A stable key, and the testID's end. */
  key: string;
  label: string;
  watts: number;
  /** An app (it opens in Activity Monitor), the rest, or the sum. */
  kind: "app" | "other" | "total";
  app?: { key: string; name: string };
}

export interface WattInput {
  battery: Battery;
  /** The battery's draw (out while discharging, in while charging); null when it doesn't say. */
  watts: number | null;
  /** idleFloor's answer. */
  floor: number | null;
  /** Every app's processor use (cores), heaviest first. */
  apps: readonly AppUse[];
  /** The apps using significant energy, heaviest first. */
  significant: readonly AppUse[];
  adapter: Adapter;
}

/** At most this many apps are named. */
export const TOP_APPS = 3;

const tenths = (watts: number): number => Math.round(watts * 10);
const fromTenths = (count: number): number => count / 10;

/** The rows, in tenths of a watt that add up exactly; empty when the battery doesn't say its draw. */
export function wattRows(input: WattInput): PowerRow[] {
  const { battery, watts, adapter } = input;
  if (battery.state === "discharging") {
    if (watts === null) return [];
    const total = tenths(watts);
    const busy = input.apps.reduce((sum, app) => sum + app.cores, 0);
    const top = input.significant.slice(0, TOP_APPS);
    if (input.floor === null || busy <= 0 || top.length === 0) return [{ key: "total", label: "Total", watts: fromTenths(total), kind: "total" }];
    const above = Math.max(watts - input.floor, 0);
    const named = top
      .map((app) => ({ app, share: Math.floor(above * (app.cores / busy) * 10) }))
      .filter((each) => each.share > 0)
      .map(
        ({ app, share }): PowerRow => ({
          key: `app:${app.key}`,
          label: app.name,
          watts: fromTenths(share),
          kind: "app",
          app: { key: app.key, name: app.name },
        }),
      );
    const rest = total - named.reduce((sum, row) => sum + tenths(row.watts), 0);
    return [
      ...named,
      { key: "other", label: named.length > 0 ? "Screen and everything else" : "Everything", watts: fromTenths(Math.max(rest, 0)), kind: "other" },
      { key: "total", label: "Total", watts: fromTenths(total), kind: "total" },
    ];
  }
  const from = adapter.rating === null ? "From the adapter" : `From the ${adapter.rating} W adapter`;
  if (battery.state === "charging") {
    const into = watts === null ? null : tenths(watts);
    if (adapter.input === null) return into === null ? [] : [{ key: "into", label: "Into the battery", watts: fromTenths(into), kind: "other" }];
    const total = tenths(adapter.input);
    if (into === null || into > total) return [{ key: "adapter", label: from, watts: fromTenths(total), kind: "total" }];
    return [
      { key: "into", label: "Into the battery", watts: fromTenths(into), kind: "other" },
      { key: "running", label: "Running the laptop", watts: fromTenths(total - into), kind: "other" },
      { key: "adapter", label: from, watts: fromTenths(total), kind: "total" },
    ];
  }
  // On power and not charging: all the adapter gives runs the laptop.
  return adapter.input === null ? [] : [{ key: "adapter", label: from, watts: adapter.input, kind: "total" }];
}

/** "4.1 W", "16 W": tenths as they are, so the rows still add up on screen. */
export const formatWatts = (watts: number): string => (Number.isInteger(watts) ? `${watts} W` : `${watts.toFixed(1)} W`);
