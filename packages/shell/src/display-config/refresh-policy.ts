/**
 * Which refresh rate the built-in screen runs (Settings › Displays,
 * "Automatic"), pure so it can be tested, as graphics/policy.ts is for the
 * graphics card. Automatic, the default on a built-in screen that has a
 * lower rate at the size it runs: its top rate plugged in, about 60 Hz on
 * battery (the rate at that size nearest 60 that is not under 59, so a
 * 59.94 Hz panel keeps 59.94). Only the rate changes: never the size, so
 * never the scale. External screens are never changed. A fixed pick (any
 * rate chosen in Displays) turns Automatic off for that screen.
 *
 * A rate set for the session another way (Displays' resolution, an agent's
 * `set_display_mode`) is held: Automatic leaves it until the power source
 * next changes (auto-refresh.ts keeps that).
 */

import { type Mode, type Monitor, refreshLabel } from "./monitors.ts";

/** `displays.<screen>.refresh` in settings.json: Automatic (the default, not written) or a rate the person picked. */
export const REFRESH_CHOICES = ["automatic", "fixed"] as const;
export type RefreshChoice = (typeof REFRESH_CHOICES)[number];
export const isRefreshChoice = (value: unknown): value is RefreshChoice => REFRESH_CHOICES.some((choice) => choice === value);

/** On battery: the rate nearest this… */
const BATTERY_MHZ = 60_000;
/** …that is not under this (a 48 Hz mode is too slow to use). */
const BATTERY_FLOOR_MHZ = 59_000;
/** Rates closer than this are the same rate (59.94 and 60). */
const SAME_RATE_MHZ = 1_000;

export interface AutoRates {
  /** The fastest mode at the screen's size: plugged in. */
  plugged: Mode;
  /** The one nearest 60 Hz at that size: on battery. */
  battery: Mode;
}

type ScreenModes = Pick<Monitor, "builtIn" | "mode" | "modes">;

/**
 * The two modes Automatic moves between on this screen, at the size it runs
 * (or its native size while it is off); null where Automatic isn't offered:
 * an external screen, or one with no lower rate at that size.
 */
export function autoRates(monitor: ScreenModes): AutoRates | null {
  if (!monitor.builtIn) return null;
  const size = monitor.mode ?? monitor.modes.find((mode) => mode.preferred);
  if (!size) return null;
  const same = monitor.modes.filter((mode) => mode.width === size.width && mode.height === size.height);
  const plugged = same.reduce<Mode | null>((best, mode) => (best === null || mode.refreshMhz > best.refreshMhz ? mode : best), null);
  const battery = same
    .filter((mode) => mode.refreshMhz >= BATTERY_FLOOR_MHZ)
    .reduce<Mode | null>(
      (best, mode) => (best === null || Math.abs(mode.refreshMhz - BATTERY_MHZ) < Math.abs(best.refreshMhz - BATTERY_MHZ) ? mode : best),
      null,
    );
  if (!plugged || !battery || plugged.refreshMhz - battery.refreshMhz < SAME_RATE_MHZ) return null;
  const bare = (mode: Mode): Mode => ({ width: mode.width, height: mode.height, refreshMhz: mode.refreshMhz });
  return { plugged: bare(plugged), battery: bare(battery) };
}

export interface RefreshInputs {
  choice: RefreshChoice;
  plugged: boolean;
  monitor: Pick<Monitor, "builtIn" | "enabled" | "mode" | "modes">;
  /** A rate was set for the session another way since the power source last changed. */
  held: boolean;
}

export interface RefreshDecision {
  /** Automatic is a choice on this screen (Displays shows it). */
  offered: boolean;
  /** Automatic is offered and chosen. */
  automatic: boolean;
  /** The mode to set now, or null to leave the screen as it is. */
  set: Mode | null;
  /** The mode Automatic wants for this power source; null where it chooses nothing. */
  wanted: Mode | null;
  /** One line: what it is doing now ("Automatic: 60 Hz on battery"); empty where Automatic isn't offered. */
  why: string;
}

const sameRate = (a: Mode, b: Mode): boolean => a.width === b.width && a.height === b.height && Math.abs(a.refreshMhz - b.refreshMhz) < SAME_RATE_MHZ / 2;

export function decideRefresh(inputs: RefreshInputs): RefreshDecision {
  const rates = autoRates(inputs.monitor);
  const current = inputs.monitor.enabled ? inputs.monitor.mode : undefined;
  if (!rates) return { offered: false, automatic: false, set: null, wanted: null, why: "" };
  if (inputs.choice === "fixed") {
    const rate = current ? refreshLabel(current.refreshMhz) : "Its rate";
    return { offered: true, automatic: false, set: null, wanted: null, why: `${rate}, chosen by you` };
  }
  const wanted = inputs.plugged ? rates.plugged : rates.battery;
  const source = inputs.plugged ? "plugged in" : "on battery";
  const why = `Automatic: ${refreshLabel(wanted.refreshMhz)} ${source}`;
  // Off (the lid shut with a monitor attached): nothing to set until it is on again.
  if (!current) return { offered: true, automatic: true, set: null, wanted, why };
  if (sameRate(current, wanted)) return { offered: true, automatic: true, set: null, wanted, why };
  if (inputs.held) {
    return {
      offered: true,
      automatic: true,
      set: null,
      wanted,
      why: `${refreshLabel(current.refreshMhz)} for now. Automatic picks again when you ${inputs.plugged ? "unplug" : "plug in"}`,
    };
  }
  // `wanted` is at the size the screen runs (autoRates), so the resolution and the scale stay.
  return { offered: true, automatic: true, set: wanted, wanted, why };
}
