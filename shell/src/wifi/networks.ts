/**
 * From access points to the list a person picks from: SSIDs decoded and
 * cleaned, hidden networks left out, every radio of one network merged into
 * one row, known networks first and then the strongest, the connected one
 * set apart. Pure, because the order is what the menu promises.
 */

import { barsFor } from "../system/network.ts";
import { cleanText } from "../system/text.ts";
import type { AccessPoint, JoinFailure, SavedNetwork, Security, WifiNetwork, WifiReading } from "./types.ts";

/** NM80211ApFlags and NM80211ApSecurityFlags, the bits that say how a network is protected. */
const AP_PRIVACY = 0x1;
const KEY_MGMT_PSK = 0x100;
const KEY_MGMT_8021X = 0x200;
const KEY_MGMT_SAE = 0x400;
const KEY_MGMT_OWE = 0x800;
const KEY_MGMT_OWE_TM = 0x1000;
const KEY_MGMT_SUITE_B_192 = 0x2000;

/** The kind of security an access point advertises (its `Flags`, `WpaFlags`, and `RsnFlags`). */
export function securityOf(flags: number, wpa: number, rsn: number): Security {
  const keys = wpa | rsn;
  // A WPA2/WPA3 transition network lists both; the passphrase works for either.
  if (keys & KEY_MGMT_PSK) return "psk";
  if (keys & KEY_MGMT_SAE) return "sae";
  if (keys & (KEY_MGMT_8021X | KEY_MGMT_SUITE_B_192)) return "enterprise";
  if (keys & (KEY_MGMT_OWE | KEY_MGMT_OWE_TM)) return "owe";
  if (keys !== 0) return "other";
  return flags & AP_PRIVACY ? "wep" : "none";
}

/** Shows a lock: anything that is not open or opportunistically encrypted. */
export const isSecured = (security: Security): boolean => security !== "none" && security !== "owe";

/** Joining this for the first time needs a password typed in. */
export const needsPassword = (security: Security): boolean => security === "psk" || security === "sae";

/** Joining this for the first time is something this code can do. */
export const canJoinNew = (security: Security): boolean => security === "none" || security === "owe" || needsPassword(security);

export function ssidKey(ssid: Uint8Array): string {
  return Array.from(ssid, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The SSID bytes a key stands for; null if it is not a key `ssidKey` could have made. */
export function ssidFromKey(key: string): Uint8Array | null {
  if (key.length > 64 || key.length % 2 !== 0 || !/^[0-9a-f]*$/.test(key)) return null;
  return Uint8Array.from(key.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
}

/** The name to show for an SSID; empty for a hidden network. */
export function displayName(ssid: Uint8Array): string {
  return cleanText(new TextDecoder().decode(ssid));
}

export interface NetworkList {
  /** The network the device is connected to. */
  current: WifiNetwork | null;
  /** Everything else, known networks first, then by signal. */
  others: WifiNetwork[];
  /** Every network with a saved profile, in range or not, the most recently used first. */
  saved: SavedNetwork[];
}

/** Known first, then the stronger, then by name (code units, so the order is the same everywhere). */
export function compareNetworks(a: WifiNetwork, b: WifiNetwork): number {
  if (a.known !== b.known) return a.known ? -1 : 1;
  if (a.signal !== b.signal) return b.signal - a.signal;
  if (a.ssid !== b.ssid) return a.ssid < b.ssid ? -1 : 1;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

export function buildNetworks(reading: Extract<WifiReading, { kind: "ready" }>): NetworkList {
  // The profile that connected last stands for a network that has several.
  const profiles = new Map<string, { id: string; lastUsed: number }>();
  for (const profile of reading.known) {
    const key = ssidKey(profile.ssid);
    const seen = profiles.get(key);
    if (!seen || profile.lastUsed > seen.lastUsed) profiles.set(key, profile);
  }

  const network = (ap: AccessPoint, key: string, ssid: string): WifiNetwork => ({
    key,
    ssid,
    signal: ap.strength,
    bars: barsFor(ap.strength),
    security: ap.security,
    secured: isSecured(ap.security),
    known: profiles.has(key),
    apId: ap.id,
    profile: profiles.get(key)?.id ?? null,
  });

  // Hidden networks announce no name (an empty SSID, or NULs): nothing to show.
  const groups = new Map<string, { ssid: string; aps: AccessPoint[] }>();
  for (const ap of reading.aps) {
    const ssid = displayName(ap.ssid);
    if (ssid === "") continue;
    const key = ssidKey(ap.ssid);
    const group = groups.get(key);
    if (group) group.aps.push(ap);
    else groups.set(key, { ssid, aps: [ap] });
  }

  let current: WifiNetwork | null = null;
  const others: WifiNetwork[] = [];
  for (const [key, { ssid, aps }] of groups) {
    const active = aps.find((ap) => ap.id === reading.active);
    if (active) {
      current = network(active, key, ssid);
      continue;
    }
    const strongest = aps.reduce((best, ap) => (ap.strength > best.strength || (ap.strength === best.strength && ap.id < best.id) ? ap : best));
    others.push(network(strongest, key, ssid));
  }
  return { current, others: others.sort(compareNetworks), saved: savedNetworks(reading) };
}

/** The saved profiles grouped by network: most recently used first, then by name. */
export function savedNetworks(reading: Pick<Extract<WifiReading, { kind: "ready" }>, "known">): SavedNetwork[] {
  const groups = new Map<string, SavedNetwork>();
  for (const profile of reading.known) {
    const ssid = displayName(profile.ssid);
    if (ssid === "") continue;
    const key = ssidKey(profile.ssid);
    const group = groups.get(key);
    if (group) groups.set(key, { ...group, profiles: [...group.profiles, profile.id], lastUsed: Math.max(group.lastUsed, profile.lastUsed) });
    else groups.set(key, { key, ssid, profiles: [profile.id], lastUsed: profile.lastUsed });
  }
  return [...groups.values()].sort((a, b) => b.lastUsed - a.lastUsed || (a.ssid < b.ssid ? -1 : a.ssid > b.ssid ? 1 : 0));
}

/** Why a password cannot be used, or null if it can. */
export function passwordProblem(security: Security, password: string): string | null {
  if (security === "sae") {
    return password === "" ? "Enter the password." : new TextEncoder().encode(password).length > 63 ? "The password can have up to 63 characters." : null;
  }
  const printable = /^[\x20-\x7e]{8,63}$/.test(password);
  return printable || /^[0-9a-fA-F]{64}$/.test(password) ? null : "The password needs 8 to 63 characters.";
}

const MESSAGES: Record<JoinFailure, string> = {
  "wrong-password": "Incorrect password.",
  unsupported: "Dashi can't join this kind of network yet.",
  "not-found": "The network is out of range.",
  timeout: "Joining took too long.",
  failed: "Couldn't join the network.",
};

export const joinMessage = (reason: JoinFailure): string => MESSAGES[reason];
