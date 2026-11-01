/**
 * A pretend Wi-Fi, for development runs. A shell nested in a window on a
 * developer's machine must never touch that machine's real network: clicking
 * a network would drop the laptop's own connection. So the nested run (see
 * `select.ts`) gets this instead of NetworkManager: a fixed set of access
 * points with every case the list handles (duplicates, a hidden network,
 * open and secured ones, one this code cannot join), a radio that is only a
 * flag, and joins that take a moment. A password containing "wrong" is
 * refused; any other is accepted.
 */

import { barsFor, type Network } from "../system/network.ts";
import { displayName, ssidKey } from "./networks.ts";
import type { AccessPoint, JoinResult, KnownProfile, Security, WifiBackend, WifiNetwork, WifiRadio, WifiReading } from "./types.ts";

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

const ap = (id: string, name: string, strength: number, security: Security): AccessPoint => ({ id: `/fake/ap/${id}`, ssid: encode(name), strength, security });

const ACCESS_POINTS: readonly AccessPoint[] = [
  ap("1", "Dashi Home", 82, "psk"),
  // A second radio of the same network: one row.
  ap("2", "Dashi Home", 58, "psk"),
  ap("3", "Studio 5G", 71, "psk"),
  ap("4", "Cafe Latte", 64, "none"),
  ap("5", "Neighbors", 55, "psk"),
  ap("6", "Corp Secure", 47, "enterprise"),
  ap("7", "Ünïcode Café ☕", 44, "sae"),
  ap("8", "Library Guest", 38, "none"),
  ap("9", "Hotel WiFi", 31, "none"),
  ap("10", "Old Router", 22, "wep"),
  // Hidden: announces no name.
  { id: "/fake/ap/11", ssid: new Uint8Array(0), strength: 60, security: "psk" },
];

/** Found by the first scan, to show the list filling in. */
const LATE = ap("12", "Pop-up Café", 49, "none");

const KNOWN = ["Dashi Home", "Studio 5G"];

export interface FakeOptions {
  /** How long a scan takes. */
  scanMs?: number;
  /** How long a join takes. */
  joinMs?: number;
}

export class FakeWifi implements WifiBackend {
  private on = true;
  private active: string | null = ACCESS_POINTS[0]?.id ?? null;
  private revealed = false;
  private readonly known = new Map<string, KnownProfile>(
    KNOWN.map((name, index) => [ssidKey(encode(name)), { id: `/fake/profile/${index}`, ssid: encode(name), lastUsed: 100 - index }]),
  );
  private readonly watchers = new Set<() => void>();

  constructor(private readonly options: FakeOptions = {}) {}

  /** The radio switch, for Control Center's Wi-Fi tile. */
  readonly radio: WifiRadio = {
    read: async () => this.on,
    set: async (on) => {
      this.on = on;
      if (!on) this.active = null;
      else this.active ??= ACCESS_POINTS[0]?.id ?? null;
      this.changed();
    },
  };

  private visible(): AccessPoint[] {
    return this.on ? [...ACCESS_POINTS, ...(this.revealed ? [LATE] : [])] : [];
  }

  async read(): Promise<WifiReading> {
    return { kind: "ready", aps: this.visible(), known: [...this.known.values()], active: this.active };
  }

  async scan(): Promise<void> {
    if (!this.on) return;
    await Bun.sleep(this.options.scanMs ?? 1500);
    if (!this.revealed) {
      this.revealed = true;
      this.changed();
    }
  }

  async join(network: WifiNetwork, password: string | null): Promise<JoinResult> {
    await Bun.sleep(this.options.joinMs ?? 1200);
    if (!this.on) return { ok: false, reason: "failed" };
    if (!network.known && password !== null && password.includes("wrong")) return { ok: false, reason: "wrong-password" };
    this.active = network.apId;
    if (!network.known) this.known.set(network.key, { id: `/fake/profile/${this.known.size}`, ssid: encode(network.ssid), lastUsed: Math.floor(Date.now() / 1000) });
    this.changed();
    return { ok: true };
  }

  async forget(profiles: readonly string[]): Promise<boolean> {
    for (const [key, profile] of this.known) {
      if (!profiles.includes(profile.id)) continue;
      this.known.delete(key);
      // Forgetting the network the device is on disconnects it.
      if (this.visible().some((candidate) => candidate.id === this.active && ssidKey(candidate.ssid) === key)) this.active = null;
    }
    this.changed();
    return true;
  }

  watch(onChange: () => void): () => void {
    this.watchers.add(onChange);
    return () => void this.watchers.delete(onChange);
  }

  close(): void {
    this.watchers.clear();
  }

  /** What the menu bar shows of the network, in place of `nmcli`'s answer. */
  status(): Network {
    const current = this.visible().find((candidate) => candidate.id === this.active);
    return current ? { kind: "wifi", ssid: displayName(current.ssid), signal: current.strength, bars: barsFor(current.strength) } : { kind: "offline" };
  }

  private changed(): void {
    for (const watcher of this.watchers) watcher();
  }
}
