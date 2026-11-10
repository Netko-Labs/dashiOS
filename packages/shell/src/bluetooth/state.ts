/**
 * The shapes of the Bluetooth page's state: what the store holds, what a
 * device is doing, and the failure the page reports. The store (store.ts)
 * owns the changes; these are the nouns.
 */

import type { Action } from "./failures.ts";
import type { BluetoothDevice, Failure, PairingRequest } from "./types.ts";

export type Busy = "connecting" | "disconnecting" | "pairing" | "forgetting";

export interface Failed {
  path: string;
  name: string;
  action: Action;
  reason: Failure;
  /** Pairing worked and connecting did not. */
  paired: boolean;
}

export interface BluetoothState {
  /** Null until the first read; false when BlueZ or an adapter is missing. */
  available: boolean | null;
  powered: boolean;
  /** This page is looking for devices. */
  discovering: boolean;
  /** Paired or connected devices. */
  mine: readonly BluetoothDevice[];
  /** Named devices in range that are not the person's yet, strongest first. */
  nearby: readonly BluetoothDevice[];
  /** What is happening to which device (by path). */
  busy: Readonly<Record<string, Busy>>;
  failure: Failed | null;
  /** The sheet to show, if any. */
  prompt: PairingRequest | null;
}

export interface BluetoothStoreOptions {
  /** A burst of changes is one read. */
  throttleMs?: number;
  /** How long the page looks for devices before it stops. */
  discoveryMs?: number;
}

/** Before the first read: nothing known, nothing happening. */
export const INITIAL: BluetoothState = {
  available: null,
  powered: false,
  discovering: false,
  mine: [],
  nearby: [],
  busy: {},
  failure: null,
  prompt: null,
};
