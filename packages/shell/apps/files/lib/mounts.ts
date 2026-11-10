/**
 * Volumes, from the two places that know them without asking a daemon: the
 * kernel's mount table (`/proc/self/mountinfo`) and `lsblk -J`. Mounted
 * drives are what the sidebar lists under Locations; removable partitions that
 * are not mounted are listed too, so they can be mounted. Ejecting goes
 * through udisksctl, and only for devices these lists mark ejectable: the
 * root and boot filesystems are shown but never unmounted from here.
 */

import { isRecord } from "@dashi/shape";
import { isInside } from "../../../src/shared/files/paths.ts";

export interface MountEntry {
  mountPoint: string;
  /** The device or source (`/dev/sdb1`, `tmpfs`). */
  source: string;
  fstype: string;
  /** The path within the filesystem that is mounted (`/@home` on btrfs). */
  root: string;
}

/** `\040`-style escapes in a mountinfo path. */
function unescapeMount(text: string): string {
  return text.replace(/\\([0-7]{3})/g, (_, octal: string) => String.fromCharCode(Number.parseInt(octal, 8)));
}

/** Entries of mountinfo(5): `id parent maj:min root mountpoint options [optional…] - fstype source superoptions`. */
export function parseMountinfo(text: string): MountEntry[] {
  return text.split("\n").flatMap((line): MountEntry[] => {
    const fields = line.split(" ");
    const dash = fields.indexOf("-");
    if (dash < 6 || fields.length < dash + 3) return [];
    const root = unescapeMount(fields[3] ?? "");
    const mountPoint = unescapeMount(fields[4] ?? "");
    const fstype = fields[dash + 1] ?? "";
    const source = unescapeMount(fields[dash + 2] ?? "");
    if (!mountPoint.startsWith("/")) return [];
    return [{ mountPoint, source, fstype, root }];
  });
}

export interface BlockDevice {
  path: string;
  name: string;
  label: string | null;
  uuid: string | null;
  size: number;
  fstype: string | null;
  mountpoints: string[];
  removable: boolean;
  hotplug: boolean;
  type: string;
  model: string | null;
  /** Kernel name of the parent disk. */
  parent: string | null;
  readOnly: boolean;
}

const str = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);
const bool = (value: unknown): boolean => value === true || value === "1" || value === 1;

/** Every device in `lsblk -J -b -o NAME,PATH,LABEL,UUID,SIZE,FSTYPE,MOUNTPOINTS,RM,HOTPLUG,TYPE,MODEL,PKNAME,RO` output, flattened (children after parents). */
export function parseLsblk(json: string): BlockDevice[] {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return [];
  }
  const roots = isRecord(value) ? value.blockdevices : undefined;
  if (!Array.isArray(roots)) return [];
  const out: BlockDevice[] = [];
  const visit = (node: unknown, depth: number): void => {
    if (!isRecord(node) || depth > 8) return;
    const item = node;
    const path = str(item.path);
    const name = str(item.name);
    if (path && name && /^\/dev\/(?!.*\.\.)[\w./-]+$/.test(path)) {
      // Newer util-linux has `mountpoints` (a list, with nulls), older ones `mountpoint`.
      const listed = Array.isArray(item.mountpoints) ? item.mountpoints : [item.mountpoint];
      out.push({
        path,
        name,
        label: str(item.label),
        uuid: str(item.uuid),
        size: typeof item.size === "number" ? item.size : Number(item.size) || 0,
        fstype: str(item.fstype),
        mountpoints: listed.filter((mount): mount is string => typeof mount === "string" && mount.startsWith("/")),
        removable: bool(item.rm),
        hotplug: bool(item.hotplug),
        type: str(item.type) ?? "",
        model: str(item.model),
        parent: str(item.pkname),
        readOnly: bool(item.ro),
      });
    }
    if (Array.isArray(item.children)) for (const child of item.children) visit(child, depth + 1);
  };
  for (const node of roots) visit(node, 0);
  return out;
}

export interface Volume {
  /** The device path, or `/` for the root filesystem. */
  id: string;
  name: string;
  /** Null when it is not mounted. */
  mountPoint: string | null;
  device: string | null;
  fstype: string | null;
  size: number | null;
  /** It can be unmounted and powered off from here. */
  ejectable: boolean;
  /** The disk to power off after unmounting, when it is a removable one. */
  disk: string | null;
}

/** Filesystems that are not drives. */
const VIRTUAL = new Set([
  "tmpfs",
  "devtmpfs",
  "proc",
  "sysfs",
  "cgroup2",
  "devpts",
  "securityfs",
  "pstore",
  "bpf",
  "autofs",
  "mqueue",
  "hugetlbfs",
  "fusectl",
  "debugfs",
  "tracefs",
  "configfs",
  "binfmt_misc",
  "efivarfs",
  "overlay",
  "squashfs",
  "ramfs",
  "nsfs",
  "rpc_pipefs",
  "fuse.portal",
  "fuse.gvfsd-fuse",
  "fuse.gvfs-fuse-daemon",
]);
const SYSTEM_MOUNTS = ["/boot", "/home", "/var", "/usr", "/etc", "/opt", "/srv", "/efi"];
/** Where udisks and the usual tools put removable drives. */
const MEDIA_ROOTS = (user: string): string[] => [`/run/media/${user}`, `/media/${user}`, "/media", "/mnt"];

const isMedia = (mountPoint: string, user: string): boolean => MEDIA_ROOTS(user).some((root) => mountPoint !== root && isInside(root, mountPoint));
const isSystemMount = (mountPoint: string): boolean => SYSTEM_MOUNTS.some((root) => isInside(root, mountPoint));

/**
 * The volumes to list: the root filesystem, every mounted drive under the
 * media folders (or that lsblk calls removable), and removable partitions
 * with a filesystem that are not mounted. Boot, home, and other system mounts
 * are not volumes to the person.
 */
export function volumesFrom(mounts: readonly MountEntry[], devices: readonly BlockDevice[], user: string): Volume[] {
  const byPath = new Map(devices.map((device) => [device.path, device]));
  const byName = new Map(devices.map((device) => [device.name, device]));
  const volumes: Volume[] = [];
  const root = mounts.find((mount) => mount.mountPoint === "/" && mount.root !== "/..");
  volumes.push({
    id: "/",
    name: "Computer",
    mountPoint: "/",
    device: root && byPath.has(root.source) ? root.source : null,
    fstype: root?.fstype ?? null,
    size: (root && byPath.get(root.source)?.size) || null,
    ejectable: false,
    disk: null,
  });
  const seen = new Set<string>();
  for (const mount of mounts) {
    if (mount.mountPoint === "/" || VIRTUAL.has(mount.fstype) || isSystemMount(mount.mountPoint)) continue;
    if (
      mount.mountPoint.startsWith("/run/credentials") ||
      mount.mountPoint.startsWith("/run/user") ||
      mount.mountPoint.startsWith("/proc") ||
      mount.mountPoint.startsWith("/sys") ||
      mount.mountPoint.startsWith("/dev") ||
      mount.mountPoint.startsWith("/tmp")
    )
      continue;
    const device = byPath.get(mount.source);
    const removable = device
      ? device.removable || device.hotplug || (device.parent !== null && (byName.get(device.parent)?.removable || byName.get(device.parent)?.hotplug) === true)
      : false;
    if (!removable && !isMedia(mount.mountPoint, user)) continue;
    const key = device?.path ?? mount.mountPoint;
    if (seen.has(key)) continue;
    seen.add(key);
    const parent = device?.parent ? byName.get(device.parent) : undefined;
    const base = mount.mountPoint.split("/").pop() || mount.mountPoint;
    volumes.push({
      id: device?.path ?? mount.mountPoint,
      name: device?.label ?? base,
      mountPoint: mount.mountPoint,
      device: device?.path ?? null,
      fstype: mount.fstype,
      size: device?.size ?? null,
      ejectable: device !== undefined && removable && isMedia(mount.mountPoint, user),
      disk: parent && (parent.removable || parent.hotplug) ? parent.path : null,
    });
  }
  for (const device of devices) {
    if (device.type !== "part" && device.type !== "disk" && device.type !== "rom") continue;
    if (seen.has(device.path) || device.mountpoints.length > 0 || !device.fstype) continue;
    if (device.fstype === "swap" || device.fstype.startsWith("crypto") || device.fstype === "LVM2_member") continue;
    const parent = device.parent ? byName.get(device.parent) : undefined;
    if (!(device.removable || device.hotplug || parent?.removable || parent?.hotplug)) continue;
    volumes.push({
      id: device.path,
      name: device.label ?? device.model ?? device.name,
      mountPoint: null,
      device: device.path,
      fstype: device.fstype,
      size: device.size,
      ejectable: false,
      disk: parent && (parent.removable || parent.hotplug) ? parent.path : null,
    });
  }
  return volumes;
}

/** `/dev/sdb1` and its likes only; anything else never reaches udisksctl. */
export function isDevicePath(path: string): boolean {
  return /^\/dev\/[A-Za-z0-9][A-Za-z0-9_-]*$/.test(path);
}

/** The commands that unmount a volume and power its disk off, or mount it: structured arguments, never a shell string. */
export function ejectCommands(volume: Pick<Volume, "device" | "ejectable" | "disk">): string[][] {
  if (!volume.ejectable || !volume.device || !isDevicePath(volume.device)) return [];
  const commands = [["udisksctl", "unmount", "-b", volume.device]];
  if (volume.disk && isDevicePath(volume.disk)) commands.push(["udisksctl", "power-off", "-b", volume.disk]);
  return commands;
}

export function mountCommand(volume: Pick<Volume, "device" | "mountPoint">): string[] | null {
  return volume.mountPoint === null && volume.device && isDevicePath(volume.device) ? ["udisksctl", "mount", "-b", volume.device] : null;
}

/** `udisksctl mount` says "Mounted /dev/sdb1 at /run/media/me/DISK." */
export function mountedAt(output: string): string | null {
  const match = /Mounted .+ at (\/[^\n]*?)\.?\s*$/.exec(output.trim());
  return match?.[1] ?? null;
}
