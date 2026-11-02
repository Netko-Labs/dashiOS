/**
 * What the Extras page needs to know about this computer: whether it has an
 * NVIDIA graphics card (from the PCI devices in sysfs, the way the helper
 * checks), and whether Dashi's NVIDIA and gaming packages are installed
 * already (`rpm -q`). Nothing here asks for privileges.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtrasHardware } from "./plan.ts";

const NVIDIA_VENDOR = "0x10de";

export interface PciDevice {
  vendor: string;
  /** The PCI class, `0x030000` for a VGA controller. */
  class: string;
}

/** Whether one of the devices is an NVIDIA display controller (class 0x03xxxx). */
export function hasNvidiaGpu(devices: readonly PciDevice[]): boolean {
  return devices.some((device) => device.vendor.trim().toLowerCase() === NVIDIA_VENDOR && device.class.trim().toLowerCase().startsWith("0x03"));
}

/** The PCI devices sysfs lists; none when it can't be read. */
export function pciDevices(root = "/sys/bus/pci/devices"): PciDevice[] {
  let names: string[];
  try {
    names = readdirSync(root);
  } catch {
    return [];
  }
  return names.flatMap((name) => {
    try {
      return [{ vendor: readFileSync(join(root, name, "vendor"), "utf8"), class: readFileSync(join(root, name, "class"), "utf8") }];
    } catch {
      return [];
    }
  });
}

/** Whether an RPM package is installed; false when rpm can't tell (or is not there). */
export async function isPackageInstalled(name: string): Promise<boolean> {
  try {
    const child = Bun.spawn(["rpm", "-q", "--quiet", name], { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
    return (await child.exited) === 0;
  } catch {
    return false;
  }
}

/** This computer's answers. */
export async function detectHardware(): Promise<ExtrasHardware> {
  const [nvidiaInstalled, gamingInstalled] = await Promise.all([isPackageInstalled("dashi-nvidia"), isPackageInstalled("dashi-gaming")]);
  return { nvidia: hasNvidiaGpu(pciDevices()), nvidiaInstalled, gamingInstalled };
}
