/** Volumes on this machine: read from the kernel and lsblk, mounted and ejected with udisksctl. */

import { readFile, statfs } from "node:fs/promises";
import { type Exec, exec } from "../../../src/shared/files/exec.ts";
import { ejectCommands, mountCommand, mountedAt, parseLsblk, parseMountinfo, type Volume, volumesFrom } from "./mounts.ts";

const LSBLK = ["lsblk", "-J", "-b", "-o", "NAME,PATH,LABEL,UUID,SIZE,FSTYPE,MOUNTPOINTS,RM,HOTPLUG,TYPE,MODEL,PKNAME,RO"];

export async function loadVolumes(
  user: string,
  run: Exec = exec,
  readMounts: () => Promise<string> = () => readFile("/proc/self/mountinfo", "utf8"),
): Promise<Volume[]> {
  const [mounts, blocks] = await Promise.all([readMounts().catch(() => ""), run(LSBLK).catch(() => null)]);
  return volumesFrom(parseMountinfo(mounts), blocks?.ok ? parseLsblk(blocks.stdout) : [], user);
}

const first = (text: string): string =>
  text
    .trim()
    .split("\n")[0]
    ?.replace(/^.*?:\s*/, "")
    .trim() || "";

/** Unmounts a volume and powers off its disk; an error to show, or null. */
export async function eject(volume: Volume, run: Exec = exec): Promise<string | null> {
  const commands = ejectCommands(volume);
  if (commands.length === 0) return `“${volume.name}” can’t be ejected from here.`;
  for (const [index, command] of commands.entries()) {
    const outcome = await run(command);
    // The unmount must work; powering off is a courtesy (another partition of the disk may still be in use).
    if (!outcome.ok && index === 0) return first(outcome.stderr) || `“${volume.name}” couldn’t be ejected. Something may be using it.`;
  }
  return null;
}

/** Mounts an unmounted removable volume; where it is mounted, or an error. */
export async function mount(volume: Volume, run: Exec = exec): Promise<{ path: string } | { error: string }> {
  const command = mountCommand(volume);
  if (!command) return { error: `“${volume.name}” can’t be mounted from here.` };
  const outcome = await run(command);
  if (!outcome.ok) return { error: first(outcome.stderr) || `“${volume.name}” couldn’t be mounted.` };
  const path = mountedAt(outcome.stdout);
  return path ? { path } : { error: `“${volume.name}” was mounted, but I couldn’t tell where.` };
}

/** Free and total bytes of the filesystem holding `path`, or null. */
export async function space(path: string): Promise<{ free: number; total: number } | null> {
  try {
    const info = await statfs(path);
    return { free: info.bavail * info.bsize, total: info.blocks * info.bsize };
  } catch {
    return null;
  }
}
