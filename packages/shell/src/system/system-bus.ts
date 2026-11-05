/**
 * The shell's one kept connection to the system bus, for the clients that
 * live as long as it does: power profiles (profiles.ts), dashi-hardware
 * (hardware/), and cardwire (graphics/). Made on first use; logind keeps its
 * own (power/logind.ts).
 */

import { DBusConnection } from "../dbus/index.ts";
import { BusLink } from "../dbus/link.ts";

let shared: BusLink | null = null;

export function systemBus(): BusLink {
  shared ??= BusLink.system();
  return shared;
}

let hardwareLink: BusLink | null = null;

/**
 * Where dashi-hardware is: the system bus, or the session bus when
 * `DASHI_HARDWARE_BUS=session` (a fake laptop, `dashi-hardware --sysfs-root
 * data/fixtures/ga403wr serve`, which serves there without root).
 */
export function hardwareBus(env: Record<string, string | undefined> = process.env): BusLink {
  if (env.DASHI_HARDWARE_BUS !== "session") return systemBus();
  hardwareLink ??= new BusLink(() => DBusConnection.connect({ bus: "session" }));
  return hardwareLink;
}

export function closeSystemBus(): void {
  hardwareLink?.close();
  hardwareLink = null;
  shared?.close();
  shared = null;
}
