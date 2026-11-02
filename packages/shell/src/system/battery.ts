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
  const batteries = supplies.flatMap((supply) => {
    if (supply.type !== "Battery" || supply.scope === "Device" || supply.present === "0") return [];
    const percent = percentOf(supply.capacity);
    return percent === null ? [] : [{ percent, status: supply.status }];
  });
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
  return { percent, state };
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
      const [type, status, capacity, online, present, scope] = await Promise.all(["type", "status", "capacity", "online", "present", "scope"].map(read));
      return {
        name,
        type: type ?? null,
        status: status ?? null,
        capacity: capacity ?? null,
        online: online ?? null,
        present: present ?? null,
        scope: scope ?? null,
      };
    }),
  );
}

export async function readBattery(root: string = POWER_SUPPLY): Promise<Battery | null> {
  return summarizeBattery(await readPowerSupplies(root));
}
