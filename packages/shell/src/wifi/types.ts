/**
 * What the Wi-Fi menu is made of. A backend (NetworkManager over D-Bus, or
 * the stand-in nested runs use) reports raw access points and saved profiles;
 * `networks.ts` turns those into the list a person sees.
 */

import type { Radio } from "../control-center/radios.ts";
import type { Bars } from "../system/network.ts";

/** How a network protects itself, as far as joining it goes. */
export type Security =
  | "none"
  /** Opportunistic encryption ("Enhanced Open"): joined without a password. */
  | "owe"
  | "wep"
  /** WPA/WPA2 personal: one shared passphrase. */
  | "psk"
  /** WPA3 personal. */
  | "sae"
  /** 802.1X (a username, certificates): only joinable once a profile exists. */
  | "enterprise"
  /** A kind of security this code does not know. */
  | "other";

/** One access point (one radio of a network), as the backend saw it. */
export interface AccessPoint {
  /** The backend's handle for it (NetworkManager's object path). */
  id: string;
  /** The network name as raw bytes: an SSID is not necessarily text. */
  ssid: Uint8Array;
  /** Signal strength, 0 to 100. */
  strength: number;
  security: Security;
}

/** A saved connection profile for a Wi-Fi network. */
export interface KnownProfile {
  /** The backend's handle for it. */
  id: string;
  ssid: Uint8Array;
  /** When it last connected, in seconds since the epoch; 0 for never. */
  lastUsed: number;
}

/** A network the person has joined before, in range or not: what "Known Networks" lists. */
export interface SavedNetwork {
  /** The SSID's bytes in hex, as `WifiNetwork.key`. */
  key: string;
  ssid: string;
  /** Every saved profile for the network (there can be several); forgetting deletes them all. */
  profiles: readonly string[];
  /** When it last connected, in seconds since the epoch; 0 for never. */
  lastUsed: number;
}

/** What a backend knows right now. */
export type WifiReading =
  /** No NetworkManager, or no Wi-Fi device to scan with. */
  | { kind: "unavailable" }
  | {
      kind: "ready";
      aps: readonly AccessPoint[];
      known: readonly KnownProfile[];
      /** The access point the device is connected through; null when not connected. */
      active: string | null;
    };

/** One network in the list: every access point of an SSID, merged. */
export interface WifiNetwork {
  /** The SSID's bytes in hex: identifies the network, safe to compare and serialize. */
  key: string;
  /** The name to show: decoded, with control characters removed. */
  ssid: string;
  /** 0 to 100: the connected radio's for the current network, else the strongest. */
  signal: number;
  bars: Bars;
  security: Security;
  /** Shows a lock. */
  secured: boolean;
  /** A saved profile exists, so joining asks for nothing. */
  known: boolean;
  /** The access point to join through. */
  apId: string;
  /** The saved profile to use, if any. */
  profile: string | null;
}

export type JoinFailure = "wrong-password" | "unsupported" | "not-found" | "timeout" | "failed";

export type JoinResult = { ok: true } | { ok: false; reason: JoinFailure };

export interface WifiBackend {
  /** Rejects when the system cannot be asked at all. */
  read(): Promise<WifiReading>;
  /** Asks for a scan and resolves when it has finished (or gave up waiting). */
  scan(): Promise<void>;
  /** Joins `network`; `password` is for a network that has no profile yet, or a profile that needs a new one. Never rejects. */
  join(network: WifiNetwork, password: string | null): Promise<JoinResult>;
  /** Deletes these saved profiles; true when all are gone. Never rejects. */
  forget(profiles: readonly string[]): Promise<boolean>;
  /** Calls `onChange` when the list may have changed; returns the stop function. */
  watch(onChange: () => void): () => void;
  close(): void;
}

/** The Wi-Fi radio's switch. */
export type WifiRadio = Radio;
