/**
 * What Settings shows of the battery beyond the menu bar's glyph: how much
 * charge it holds compared with when it was new (its health), and its charge
 * cycles, both from /sys/class/power_supply. Laptops report either charge
 * (`charge_*`, µAh) or energy (`energy_*`, µWh); only the ratio matters, so
 * the pair a battery has is used as it comes.
 */

import { readdir } from "node:fs/promises";
import { type Battery, POWER_SUPPLY, readPowerSupplies, summarizeBattery } from "./battery.ts";

export interface BatteryDetails extends Battery {
  /** Full capacity as a share of the design capacity, 0 to 100; null when the kernel does not say. */
  health: number | null;
  /** Charge cycles; null when the battery does not count them (many report 0). */
  cycles: number | null;
  /** On a charger or not, whatever the battery is doing. */
  pluggedIn: boolean;
}

/** The files of one battery that health needs, as text (null when missing). */
export interface HealthFiles {
  chargeFull: string | null;
  chargeFullDesign: string | null;
  energyFull: string | null;
  energyFullDesign: string | null;
  cycleCount: string | null;
}

const count = (text: string | null): number | null => {
  if (text === null || !/^\d{1,15}$/.test(text)) return null;
  const value = Number(text);
  return Number.isSafeInteger(value) ? value : null;
};

/** The capacity pair a battery reports: charge, else energy; null when neither is usable. */
function capacityPair(files: HealthFiles): { full: number; design: number } | null {
  for (const [full, design] of [
    [count(files.chargeFull), count(files.chargeFullDesign)],
    [count(files.energyFull), count(files.energyFullDesign)],
  ] as const) {
    if (full !== null && design !== null && design > 0 && full > 0) return { full, design };
  }
  return null;
}

/** Health across batteries (their capacities add up, as the percentages do), and the largest cycle count. */
export function summarizeHealth(batteries: readonly HealthFiles[]): { health: number | null; cycles: number | null } {
  const pairs = batteries.flatMap((files) => capacityPair(files) ?? []);
  const full = pairs.reduce((sum, pair) => sum + pair.full, 0);
  const design = pairs.reduce((sum, pair) => sum + pair.design, 0);
  // A battery can read above its design capacity when new; 100 is the most that is meaningful.
  const health = design > 0 ? Math.min(100, Math.round((full / design) * 100)) : null;
  const cycles = batteries.flatMap((files) => {
    const value = count(files.cycleCount);
    return value !== null && value > 0 ? [value] : [];
  });
  return { health, cycles: cycles.length > 0 ? Math.max(...cycles) : null };
}

async function readText(path: string): Promise<string | null> {
  try {
    return (await Bun.file(path).text()).trim();
  } catch {
    return null;
  }
}

/** The battery's details, or null with no battery (a desktop, a VM). */
export async function readBatteryDetails(root: string = POWER_SUPPLY): Promise<BatteryDetails | null> {
  const supplies = await readPowerSupplies(root);
  const battery = summarizeBattery(supplies);
  if (battery === null) return null;
  const ours = supplies.filter((supply) => supply.type === "Battery" && supply.scope !== "Device" && supply.present !== "0");
  const files = await Promise.all(
    ours.map(async (supply): Promise<HealthFiles> => {
      const read = (file: string) => readText(`${root}/${supply.name}/${file}`);
      const [chargeFull, chargeFullDesign, energyFull, energyFullDesign, cycleCount] = await Promise.all([
        read("charge_full"),
        read("charge_full_design"),
        read("energy_full"),
        read("energy_full_design"),
        read("cycle_count"),
      ]);
      return { chargeFull, chargeFullDesign, energyFull, energyFullDesign, cycleCount };
    }),
  );
  const pluggedIn = supplies.some(
    (supply) => supply.online === "1" && supply.scope !== "Device" && (supply.type === "Mains" || (supply.type?.startsWith("USB") ?? false)),
  );
  return { ...battery, ...summarizeHealth(files), pluggedIn };
}

/** Whether this machine has a battery at all, without reading the rest. */
export async function hasBattery(root: string = POWER_SUPPLY): Promise<boolean> {
  try {
    return (await readdir(root)).length > 0 && (await readBatteryDetails(root)) !== null;
  } catch {
    return false;
  }
}

/** A line for the battery's state: "Charging", "On battery", … */
export function describeBattery(battery: Pick<BatteryDetails, "state" | "pluggedIn">): string {
  switch (battery.state) {
    case "charging":
      return "Charging";
    case "full":
      return "Fully charged";
    case "plugged":
      return "Plugged in, not charging";
    case "discharging":
      return battery.pluggedIn ? "Plugged in" : "On battery";
  }
}
