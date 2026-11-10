/**
 * NetworkManager's D-Bus values, read strictly: what comes back from the
 * system bus is untrusted until each field has the type it should, and an
 * access point or profile that does not is skipped rather than guessed at.
 * And the settings that go the other way, to create a profile or give a saved
 * one a new password.
 */

import { Variant, variant } from "../shared/dbus/index.ts";
import { propertyMap, unwrap } from "../shared/dbus/properties.ts";
import { securityOf } from "./networks.ts";
import type { AccessPoint, KnownProfile, Security } from "./types.ts";

export { propertyMap, unwrap };

const isCount = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;

/** An SSID is up to 32 bytes; copied out of the message buffer it came in. */
function ssidOf(value: unknown): Uint8Array | null {
  return value instanceof Uint8Array && value.length <= 32 ? Uint8Array.from(value) : null;
}

/** The access point at `id` from its `org.freedesktop.NetworkManager.AccessPoint` properties. */
export function parseAccessPoint(id: string, properties: ReadonlyMap<string, unknown>): AccessPoint | null {
  const ssid = ssidOf(properties.get("Ssid"));
  const strength = properties.get("Strength");
  const flags = properties.get("Flags");
  const wpa = properties.get("WpaFlags");
  const rsn = properties.get("RsnFlags");
  if (!ssid || !isCount(strength) || strength > 100 || !isCount(flags) || !isCount(wpa) || !isCount(rsn)) return null;
  return { id, ssid, strength, security: securityOf(flags, wpa, rsn) };
}

/** A settings dictionary (`a{sa{sv}}`) as sections of plain values; null if it is not one. */
export function parseSettings(reply: unknown): Map<string, Map<string, unknown>> | null {
  if (!(reply instanceof Map)) return null;
  const sections = new Map<string, Map<string, unknown>>();
  for (const [name, section] of reply) {
    const properties = typeof name === "string" ? propertyMap(section) : null;
    if (!properties) return null;
    sections.set(name as string, properties);
  }
  return sections;
}

/** A saved infrastructure Wi-Fi connection from `GetSettings`; other kinds of connection are null. */
export function parseProfile(id: string, reply: unknown): KnownProfile | null {
  const settings = parseSettings(reply);
  const connection = settings?.get("connection");
  const wireless = settings?.get("802-11-wireless");
  if (connection?.get("type") !== "802-11-wireless" || !wireless) return null;
  const mode = wireless.get("mode");
  if (mode !== undefined && mode !== "infrastructure") return null;
  const ssid = ssidOf(wireless.get("ssid"));
  if (!ssid) return null;
  const stamp = connection.get("timestamp");
  const seconds = typeof stamp === "bigint" ? Number(stamp) : isCount(stamp) ? stamp : 0;
  return { id, ssid, lastUsed: Number.isSafeInteger(seconds) ? seconds : 0 };
}

/** `Wi-Fi settings` as the bus wants them: sections of name-to-variant entries. */
export type Settings = Record<string, Record<string, Variant>>;

function securitySection(security: Security, password: string | null): Record<string, Variant> | null {
  switch (security) {
    case "none":
      return null;
    case "owe":
      return { "key-mgmt": variant("s", "owe") };
    case "psk":
    case "sae":
      return {
        "key-mgmt": variant("s", security === "psk" ? "wpa-psk" : "sae"),
        ...(password === null ? {} : { psk: variant("s", password), "psk-flags": variant("u", 0) }),
      };
    default:
      throw new TypeError(`cannot make a profile for ${security} security`);
  }
}

/** A new profile for a network, to hand to `AddAndActivateConnection`. */
export function newProfile(ssid: Uint8Array, name: string, security: Security, password: string | null, uuid: string): Settings {
  const section = securitySection(security, password);
  return {
    connection: { id: variant("s", name), uuid: variant("s", uuid), type: variant("s", "802-11-wireless") },
    "802-11-wireless": { ssid: variant("ay", ssid), mode: variant("s", "infrastructure") },
    ...(section ? { "802-11-wireless-security": section } : {}),
    ipv4: { method: variant("s", "auto") },
    ipv6: { method: variant("s", "auto") },
  };
}

/**
 * A saved profile's settings with a new password, to hand to `Update`.
 * `GetSettings` returns the sections as variants, which go back as they came;
 * only the password changes, and it is stored with the profile (flag 0), so
 * nothing has to be asked for again.
 */
export function withPassword(reply: unknown, security: Security, password: string): Settings | null {
  if (!(reply instanceof Map) || (security !== "psk" && security !== "sae")) return null;
  const settings: Settings = {};
  for (const [name, section] of reply) {
    if (typeof name !== "string" || !(section instanceof Map)) return null;
    const entries: Record<string, Variant> = {};
    for (const [key, value] of section) {
      if (typeof key !== "string" || !(value instanceof Variant)) return null;
      entries[key] = value;
    }
    settings[name] = entries;
  }
  // The profile's own key management stays; one without it gets the network's.
  const existing = settings["802-11-wireless-security"] ?? {};
  settings["802-11-wireless-security"] = {
    ...existing,
    "key-mgmt": existing["key-mgmt"] ?? variant("s", security === "sae" ? "sae" : "wpa-psk"),
    psk: variant("s", password),
    "psk-flags": variant("u", 0),
  };
  return settings;
}
