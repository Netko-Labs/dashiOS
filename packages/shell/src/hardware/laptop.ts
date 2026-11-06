/**
 * Whether this machine is a laptop: the laptop-only rows and panes (the
 * charge limit, the keyboard light, the graphics card, the Control Center
 * row) appear only then. dashi-hardware's `Describe().laptop` says so when
 * the helper runs; without it, the same test here: the firmware's chassis
 * type (/sys/class/dmi/id/chassis_type) is a portable one and a system
 * battery is present.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { POWER_SUPPLY } from "../system/battery.ts";

/** SMBIOS chassis types: portable, laptop, notebook, sub notebook, convertible, detachable. */
export const LAPTOP_CHASSIS: ReadonlySet<number> = new Set([8, 9, 10, 14, 31, 32]);

export function isLaptopChassis(text: string | null): boolean {
  if (text === null || !/^\d+$/.test(text.trim())) return false;
  return LAPTOP_CHASSIS.has(Number(text.trim()));
}

const read = (path: string): string | null => {
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return null;
  }
};

/** A battery that powers the system (not a mouse's: scope Device). */
export function hasSystemBattery(root = POWER_SUPPLY): boolean {
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return false;
  }
  return entries.some(
    (name) => read(join(root, name, "type")) === "Battery" && read(join(root, name, "scope")) !== "Device" && read(join(root, name, "present")) !== "0",
  );
}

/** The fallback check, without the helper. */
export function detectLaptop(dmi = "/sys/class/dmi/id", supplies = POWER_SUPPLY): boolean {
  return isLaptopChassis(read(join(dmi, "chassis_type"))) && hasSystemBattery(supplies);
}
