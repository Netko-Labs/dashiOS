/**
 * Suspending, restarting, and powering off the machine through logind
 * (`org.freedesktop.login1.Manager` on the system bus), with no `systemctl`
 * in between. Whether the machine is ours to power off is not decided here:
 * menus/session.ts asks that first and calls this only for a real session.
 */

import type { ConnectOptions } from "../dbus/index.ts";
import { Logind, type MachineMethod } from "./logind.ts";

export type MachineAction = "sleep" | "restart" | "shutdown";

/** The logind method for a power action. */
export const MACHINE_METHOD: Readonly<Record<MachineAction, MachineMethod>> = {
  sleep: "Suspend",
  restart: "Reboot",
  shutdown: "PowerOff",
};

/** Asks logind to do `what` over a short-lived connection; rejects when there is no system bus, no logind, or it refuses. */
export async function powerMachine(what: MachineAction, options: ConnectOptions = {}): Promise<void> {
  const logind = await Logind.connect(options);
  try {
    await logind.machine(MACHINE_METHOD[what]);
  } finally {
    logind.close();
  }
}
