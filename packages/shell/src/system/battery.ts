/**
 * The battery, from /sys/class/power_supply: the kernel's one stable view of
 * every battery and charger. A desktop or a VM has no battery, and then
 * there is nothing to show.
 */

import { readdir } from "node:fs/promises";

export const POWER_SUPPLY = "/sys/class/power_supply";

export type BatteryState = "charging" | "discharging" | "full" | "plugged";

export interface Battery {
  /** 0 to 100. */
  percent: number;
  /**
   * `plugged` is on a charger but not charging (a charge limit, or a status
   * the firmware does not report).
   */
  state: BatteryState;
  /** Minutes until full while charging, until empty while discharging; absent when the battery can't say (no rate yet). */
  minutesLeft?: number;
}

/** One entry of /sys/class/power_supply, as its files read (trimmed). */
export interface PowerSupply {
  name: string;
  type: string | null;
  status: string | null;
  capacity: string | null;
  online: string | null;
  present: string | null;
  scope: string | null;
  /** µWh and µW, for batteries that report energy. */
  energyNow?: string | null;
  energyFull?: string | null;
  powerNow?: string | null;
  /** µAh and µA, for batteries that report charge instead. */
  chargeNow?: string | null;
  chargeFull?: string | null;
  currentNow?: string | null;
}

/** Longer than this is a rate too small to mean anything (a battery at rest). */
const MAX_MINUTES = 48 * 60;

const amount = (text: string | null | undefined): number | null => (text && /^-?\d+$/.test(text) ? Math.abs(Number(text)) : null);

/**
 * Minutes until full (charging) or empty (discharging) for these batteries
 * together, from what they hold now, hold when full, and the rate they are
 * moving at: energy if they report it, else charge. Null when they don't say
 * or the rate is too small to time.
 */
export function minutesLeft(batteries: readonly PowerSupply[], charging: boolean): number | null {
  const totals = { now: 0, full: 0, rate: 0 };
  for (const battery of batteries) {
    const energy = amount(battery.energyNow) !== null;
    const now = amount(energy ? battery.energyNow : battery.chargeNow);
    const full = amount(energy ? battery.energyFull : battery.chargeFull);
    const rate = amount(energy ? battery.powerNow : battery.currentNow);
    if (now === null || full === null || rate === null) return null;
    totals.now += now;
    totals.full += full;
    totals.rate += rate;
  }
  if (totals.rate <= 0) return null;
  const minutes = ((charging ? Math.max(totals.full - totals.now, 0) : totals.now) / totals.rate) * 60;
  return minutes > MAX_MINUTES ? null : Math.round(minutes);
}

/** "2:05" for 125 minutes: what the battery menu says is left. */
export function formatMinutes(minutes: number): string {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

/** A whole number from 0 to 100, or null. */
function percentOf(text: string | null): number | null {
  if (text === null || !/^\d{1,3}$/.test(text)) return null;
  const value = Number(text);
  return value <= 100 ? value : null;
}

/**
 * What the menu bar shows for these supplies, or null with no battery. Only
 * the laptop's own batteries count: a wireless mouse's is `scope: Device`.
 */
export function summarizeBattery(supplies: readonly PowerSupply[]): Battery | null {
  const own = supplies.filter(
    (supply) => supply.type === "Battery" && supply.scope !== "Device" && supply.present !== "0" && percentOf(supply.capacity) !== null,
  );
  const batteries = own.map((supply) => ({ percent: percentOf(supply.capacity) as number, status: supply.status }));
  if (batteries.length === 0) return null;

  const percent = Math.round(batteries.reduce((sum, battery) => sum + battery.percent, 0) / batteries.length);
  const statuses = batteries.map((battery) => battery.status);
  // Chargers: the wall adapter (Mains) or a USB-C source (USB, USB_PD, ...).
  const onCharger = supplies.some(
    (supply) => supply.online === "1" && supply.scope !== "Device" && (supply.type === "Mains" || (supply.type?.startsWith("USB") ?? false)),
  );

  let state: BatteryState;
  if (statuses.includes("Charging")) state = "charging";
  else if (statuses.includes("Discharging")) state = "discharging";
  else if (statuses.every((status) => status === "Full")) state = "full";
  else if (statuses.includes("Not charging") || onCharger) state = "plugged";
  // "Unknown" with no charger: the battery is all there is.
  else state = "discharging";
  const left = state === "charging" || state === "discharging" ? minutesLeft(own, state === "charging") : null;
  return { percent, state, ...(left === null ? {} : { minutesLeft: left }) };
}

async function readText(path: string): Promise<string | null> {
  try {
    return (await Bun.file(path).text()).trim();
  } catch {
    return null;
  }
}

export async function readPowerSupplies(root: string = POWER_SUPPLY): Promise<PowerSupply[]> {
  let names: string[];
  try {
    names = (await readdir(root)).sort();
  } catch {
    return [];
  }
  return Promise.all(
    names.map(async (name) => {
      const read = (file: string) => readText(`${root}/${name}/${file}`);
      const files = [
        "type",
        "status",
        "capacity",
        "online",
        "present",
        "scope",
        "energy_now",
        "energy_full",
        "power_now",
        "charge_now",
        "charge_full",
        "current_now",
      ];
      const [type, status, capacity, online, present, scope, energyNow, energyFull, powerNow, chargeNow, chargeFull, currentNow] = await Promise.all(
        files.map(read),
      );
      return {
        name,
        type: type ?? null,
        status: status ?? null,
        capacity: capacity ?? null,
        online: online ?? null,
        present: present ?? null,
        scope: scope ?? null,
        energyNow: energyNow ?? null,
        energyFull: energyFull ?? null,
        powerNow: powerNow ?? null,
        chargeNow: chargeNow ?? null,
        chargeFull: chargeFull ?? null,
        currentNow: currentNow ?? null,
      };
    }),
  );
}

export async function readBattery(root: string = POWER_SUPPLY): Promise<Battery | null> {
  return summarizeBattery(await readPowerSupplies(root));
}
