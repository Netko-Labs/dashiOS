/**
 * The live ISO (spin/): booted from the USB stick, the Setup Assistant's
 * first page offers "Install Dashi", which runs Fedora's live installer
 * (`liveinst`, Anaconda). An installed system boots without `rd.live.image`,
 * so the button is not there.
 */

import { readFileSync } from "node:fs";

/** The installer's command, when this boot is the live image and it has one. */
export function liveInstaller(cmdline: string, which: (program: string) => string | null): string | null {
  const live = cmdline.split(/\s+/).some((arg) => arg === "rd.live.image" || arg.startsWith("rd.live.image="));
  return live ? which("liveinst") : null;
}

/** `liveInstaller` for this machine. */
export function systemLiveInstaller(): string | null {
  let cmdline = "";
  try {
    cmdline = readFileSync("/proc/cmdline", "utf8");
  } catch {
    return null;
  }
  return liveInstaller(cmdline, (program) => Bun.which(program));
}

/** Start the installer; it asks polkit for root itself. False when it could not start. */
export function startInstaller(command: string): boolean {
  try {
    Bun.spawn([command], { stdin: "ignore", stdout: "ignore", stderr: "ignore", detached: true }).unref();
    return true;
  } catch (error) {
    console.error("dashi-shell: could not start the installer:", error instanceof Error ? error.message : error);
    return false;
  }
}
