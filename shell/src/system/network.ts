/**
 * The network, through NetworkManager's `nmcli -t`: Wi-Fi with its signal,
 * wired, or offline. NetworkManager is how most distributions connect; a
 * system without it has no network glyph rather than a wrong one.
 */

import type { Run } from "./exec.ts";
import { parseTerse } from "./terse.ts";

/** Wi-Fi arcs lit, 0 (just the dot) to 3. */
export type Bars = 0 | 1 | 2 | 3;

export type Network =
  | { kind: "offline" }
  | { kind: "wired" }
  | { kind: "wifi"; ssid: string; signal: number | null; bars: Bars };

/** The arcs for a signal strength (percent, as NetworkManager reports it). */
export function barsFor(signal: number | null): Bars {
  // A connected network whose signal is unknown (a stale scan) is not a weak one.
  if (signal === null || signal >= 65) return 3;
  if (signal >= 40) return 2;
  if (signal >= 15) return 1;
  return 0;
}

const DEVICES = ["nmcli", "-t", "-f", "DEVICE,TYPE,STATE", "dev", "status"] as const;
// --rescan no: the list is what NetworkManager already knows; asking for a
// scan from a menu bar would stall the radio.
const WIFI = ["nmcli", "-t", "-f", "IN-USE,SIGNAL,SSID", "dev", "wifi", "list", "--rescan", "no"] as const;

/** `connected`, and also `connected (externally)` and `connected (site only)`. */
function isConnected(state: string): boolean {
  return state === "connected" || state.startsWith("connected (");
}

/** From `dev status` rows: which kinds of device are connected. */
export function connectedKinds(output: string): { wired: boolean; wifi: boolean } {
  const rows = parseTerse(output, 3);
  const connected = (type: string) => rows.some(([, kind, state]) => kind === type && state !== undefined && isConnected(state));
  return { wired: connected("ethernet"), wifi: connected("wifi") };
}

/** From `dev wifi list` rows: the network in use (`*`), if the list has it. */
export function activeWifi(output: string): { ssid: string; signal: number | null } | null {
  for (const [inUse, signal, ssid] of parseTerse(output, 3)) {
    if (inUse !== "*") continue;
    const strength = signal !== undefined && /^\d{1,3}$/.test(signal) ? Number(signal) : null;
    return { ssid: ssid ?? "", signal: strength !== null && strength <= 100 ? strength : null };
  }
  return null;
}

/** The network now, or null when NetworkManager cannot be asked. */
export async function readNetwork(run: Run): Promise<Network | null> {
  const devices = await run(DEVICES);
  if (devices === null) return null;
  const { wired, wifi } = connectedKinds(devices);
  if (wired) return { kind: "wired" };
  if (!wifi) return { kind: "offline" };
  const active = activeWifi((await run(WIFI)) ?? "");
  return { kind: "wifi", ssid: active?.ssid ?? "", signal: active?.signal ?? null, bars: barsFor(active?.signal ?? null) };
}
