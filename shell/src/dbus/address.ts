/**
 * Where the buses are. The session bus is named by `DBUS_SESSION_BUS_ADDRESS`
 * and falls back to `$XDG_RUNTIME_DIR/bus`; the system bus is the well-known
 * socket unless `DBUS_SYSTEM_BUS_ADDRESS` says otherwise. Only `unix:path=`
 * addresses are supported (no abstract sockets, no TCP).
 */

import { join } from "node:path";

export type BusKind = "session" | "system";

export const SYSTEM_BUS_PATH = "/run/dbus/system_bus_socket";

/** An address value with its `%xx` escapes decoded; null if one is malformed. */
function unescape(value: string): string | null {
  const bytes: number[] = [];
  const encoder = new TextEncoder();
  for (let i = 0; i < value.length; i++) {
    if (value[i] !== "%") {
      bytes.push(...encoder.encode(String.fromCodePoint(value.codePointAt(i) as number)));
      if ((value.codePointAt(i) as number) > 0xffff) i++;
      continue;
    }
    const hex = value.slice(i + 1, i + 3);
    if (!/^[0-9A-Fa-f]{2}$/.test(hex)) return null;
    bytes.push(Number.parseInt(hex, 16));
    i += 2;
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

/**
 * The socket paths a bus address lists, in order. Entries of other
 * transports, and malformed ones, are skipped.
 */
export function socketPaths(address: string): string[] {
  const paths: string[] = [];
  for (const entry of address.split(";")) {
    const colon = entry.indexOf(":");
    if (colon < 0 || entry.slice(0, colon) !== "unix") continue;
    for (const pair of entry.slice(colon + 1).split(",")) {
      const eq = pair.indexOf("=");
      if (eq < 0 || pair.slice(0, eq) !== "path") continue;
      const path = unescape(pair.slice(eq + 1));
      if (path && path.startsWith("/") && !path.includes("\0")) paths.push(path);
    }
  }
  return paths;
}

/** The address string for a well-known bus, from the environment. */
export function busAddress(kind: BusKind, env: Record<string, string | undefined> = process.env): string | null {
  if (kind === "system") return env.DBUS_SYSTEM_BUS_ADDRESS || `unix:path=${SYSTEM_BUS_PATH}`;
  if (env.DBUS_SESSION_BUS_ADDRESS) return env.DBUS_SESSION_BUS_ADDRESS;
  return env.XDG_RUNTIME_DIR ? `unix:path=${join(env.XDG_RUNTIME_DIR, "bus")}` : null;
}
