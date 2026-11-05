/**
 * The `power` and `graphics` sections of settings.json (settings-app/store.ts
 * holds them with the rest):
 *
 *   "power": { "mode": "automatic", "chargeLimit": 80, "fullChargeOnce": false,
 *              "fullBy": "08:00", "fullByDays": "weekdays",
 *              "boost": "always", "epp": "recipe", "batteryMaxKhz": 3900000 }
 *   "graphics": { "mode": "automatic" }
 *
 * `mode` is "automatic" (the default) or one of the three modes; a manual
 * pick wins over Automatic. `chargeLimit` (20 to 100) is where charging stops
 * (none: the firmware's own); `fullChargeOnce` charges to full once, then the
 * limit is back; `fullBy` with `fullByDays` ("weekdays" or "daily") charges to
 * full by that time. `boost` is "always", "plugged" or "off" (none: the
 * recipe's), `epp` the energy preference over the recipe's ("recipe" or
 * absent: the recipe's), `batteryMaxKhz` the processor's top speed on
 * battery (0 or absent: no cap). `graphics.mode` is "automatic" (the default),
 * "integrated", "hybrid" or "smart" (graphics/policy.ts).
 */

import type { ModeChoice } from "./types.ts";

export const BOOST_CHOICES = ["always", "plugged", "off"] as const;
export type BoostChoice = (typeof BOOST_CHOICES)[number];
export const EPP_CHOICES = ["recipe", "power", "balance_power", "balance_performance", "performance"] as const;
export type EppChoice = (typeof EPP_CHOICES)[number];
export const FULL_BY_DAYS = ["weekdays", "daily"] as const;
export type FullByDays = (typeof FULL_BY_DAYS)[number];
export const GRAPHICS_CHOICES = ["automatic", "integrated", "hybrid", "smart"] as const;
export type GraphicsChoice = (typeof GRAPHICS_CHOICES)[number];

export const CHARGE_LIMIT_MIN = 20;
export const CHARGE_LIMIT_MAX = 100;

export interface PowerSection {
  mode?: ModeChoice;
  chargeLimit?: number;
  fullChargeOnce?: boolean;
  /** "HH:MM". */
  fullBy?: string;
  fullByDays?: FullByDays;
  boost?: BoostChoice;
  epp?: EppChoice;
  batteryMaxKhz?: number;
}

export interface GraphicsSettings {
  mode?: GraphicsChoice;
}

type Check = (value: unknown) => boolean;
const oneOf =
  (options: readonly string[]): Check =>
  (value) =>
    typeof value === "string" && options.includes(value);
const wholeIn =
  (min: number, max: number): Check =>
  (value) =>
    typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
const isBoolean: Check = (value) => typeof value === "boolean";
const isClock: Check = (value) => typeof value === "string" && /^([01]?\d|2[0-3]):[0-5]\d$/.test(value);

/** The checks settings-app/store.ts runs on each key, on read and before a write. */
export const POWER_FIELDS = {
  mode: oneOf(["automatic", "low-power", "balanced", "performance"]),
  chargeLimit: wholeIn(CHARGE_LIMIT_MIN, CHARGE_LIMIT_MAX),
  fullChargeOnce: isBoolean,
  fullBy: isClock,
  fullByDays: oneOf(FULL_BY_DAYS),
  boost: oneOf(BOOST_CHOICES),
  epp: oneOf(EPP_CHOICES),
  // Up to 10 GHz, in kHz as cpufreq counts.
  batteryMaxKhz: wholeIn(0, 10_000_000),
} as const satisfies Record<keyof PowerSection, Check>;

export const GRAPHICS_FIELDS = { mode: oneOf(GRAPHICS_CHOICES) } as const satisfies Record<keyof GraphicsSettings, Check>;
