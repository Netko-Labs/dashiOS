/**
 * What the Installer needs to know about this computer before it asks
 * anything: the disks it could install on (lsblk), which one it started
 * from, whether it has an NVIDIA GPU, whether it started with UEFI, and
 * whether CachyOS's kernel can boot it (dashi-kernel's `default-kernel
 * --check`). Nothing here needs root.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** The least a disk can hold for Dashi, as dashi-install checks. */
export const MIN_BYTES = 20 * 1024 ** 3;

export interface Disk {
  /** `/dev/nvme0n1`. */
  path: string;
  /** What the disk calls itself ("Samsung SSD 990 PRO 1TB"), or a description from its kind. */
  name: string;
  bytes: number;
  /** How it is connected: nvme, sata, usb, virtio, … ("" when lsblk doesn't say). */
  transport: string;
  removable: boolean;
  /** Why it can't be picked, if it can't. */
  unavailable?: string;
}

export interface Machine {
  disks: Disk[];
  uefi: boolean;
  nvidia: boolean;
  /** CachyOS's kernel boots here (an x86-64-v3 CPU, Secure Boot off). */
  cachyos: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const flag = (value: unknown): boolean => value === true || value === "1" || value === 1;

/** "1 TB", "512 GB": decimal, as disks are sold. */
export function sizeLabel(bytes: number): string {
  const units = ["bytes", "KB", "MB", "GB", "TB", "PB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  const rounded = value >= 100 || unit === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unit]}`;
}

const KIND: Record<string, string> = { nvme: "NVMe drive", sata: "SATA drive", ata: "SATA drive", usb: "USB drive", virtio: "Virtual disk", mmc: "SD card" };

/**
 * The disks in `lsblk -J -b -d -o PATH,SIZE,MODEL,TRAN,RM,RO,TYPE` output:
 * whole, writable disks (no CD drives, zram, or loops), the ones too small or
 * in `busy` (the USB drive it started from, the running system), with why,
 * marked unavailable.
 */
export function parseDisks(json: unknown, busy: ReadonlyMap<string, string> = new Map()): Disk[] {
  const devices = isRecord(json) && Array.isArray(json.blockdevices) ? json.blockdevices : [];
  return devices.flatMap((device: unknown): Disk[] => {
    if (!isRecord(device) || text(device.type) !== "disk" || flag(device.ro)) return [];
    const path = text(device.path);
    if (!path.startsWith("/dev/") || /^\/dev\/(zram|loop|ram)/.test(path)) return [];
    const bytes = Number(device.size);
    if (!Number.isFinite(bytes) || bytes <= 0) return [];
    const transport = text(device.tran);
    const disk: Disk = { path, name: text(device.model) || KIND[transport] || "Disk", bytes, transport, removable: flag(device.rm) };
    const reason = busy.get(path);
    if (reason) disk.unavailable = reason;
    else if (bytes < MIN_BYTES) disk.unavailable = `Too small: Dashi needs ${sizeLabel(MIN_BYTES)}.`;
    return [disk];
  });
}

/** The disk under a partition or disk (`/dev/sdb1` → `/dev/sdb`), as lsblk answers (`-no PKNAME`). */
async function diskOf(device: string): Promise<string | null> {
  const out = await capture(["lsblk", "-ndo", "PKNAME,TYPE", device]);
  const [parent, type] = out?.trim().split(/\s+/) ?? [];
  if (type === "disk") return device;
  return parent ? `/dev/${parent}` : null;
}

async function capture(command: string[]): Promise<string | null> {
  try {
    const child = Bun.spawn(command, { stdout: "pipe", stderr: "ignore", stdin: "ignore" });
    const out = await new Response(child.stdout).text();
    return (await child.exited) === 0 ? out : null;
  } catch {
    return null;
  }
}

/** Whether a PCI display controller from NVIDIA (vendor 0x10de) is in `root` (/sys/bus/pci/devices). */
export function hasNvidia(root = "/sys/bus/pci/devices"): boolean {
  try {
    return readdirSync(root).some((device) => {
      const read = (file: string) => {
        try {
          return readFileSync(join(root, device, file), "utf8").trim();
        } catch {
          return "";
        }
      };
      return read("vendor") === "0x10de" && read("class").startsWith("0x03");
    });
  } catch {
    return false;
  }
}

/** Everything at once; what can't be found is the safe answer (no disks, no NVIDIA, Fedora's kernel). */
export async function probeMachine(): Promise<Machine> {
  const busy = new Map<string, string>();
  const reasons: [string, string][] = [
    ["/run/initramfs/live", "The Dashi USB drive this computer started from."],
    ["/", "The system running now is on this disk."],
  ];
  for (const [mount, reason] of reasons) {
    const source = (await capture(["findmnt", "-nvo", "SOURCE", mount]))?.trim().split("\n")[0];
    const disk = source?.startsWith("/dev/") ? await diskOf(source) : null;
    if (disk && !busy.has(disk)) busy.set(disk, reason);
  }
  const listed = await capture(["lsblk", "-J", "-b", "-d", "-o", "PATH,SIZE,MODEL,TRAN,RM,RO,TYPE"]);
  let disks: Disk[] = [];
  try {
    disks = parseDisks(listed ? JSON.parse(listed) : null, busy);
  } catch {
    disks = [];
  }
  const check = await capture(["/usr/libexec/dashi/default-kernel", "--check"]);
  return { disks, uefi: existsSync("/sys/firmware/efi"), nvidia: hasNvidia(), cachyos: check?.trim() === "cachyos" };
}
