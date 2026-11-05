/**
 * The shell's one kept connection to the system bus, for the clients that
 * live as long as it does: power profiles (profiles.ts), dashi-hardware
 * (hardware/), and cardwire (graphics/). Made on first use; logind keeps its
 * own (power/logind.ts).
 */

import { BusLink } from "../dbus/link.ts";

let shared: BusLink | null = null;

export function systemBus(): BusLink {
  shared ??= BusLink.system();
  return shared;
}

export function closeSystemBus(): void {
  shared?.close();
  shared = null;
}
