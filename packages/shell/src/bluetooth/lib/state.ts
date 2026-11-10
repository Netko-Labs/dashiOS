/**
 * The Bluetooth page's state before the first read. Its shapes (what the
 * store holds, what a device is doing, the failure the page reports) are in
 * types.ts; the store (store.ts) owns the changes.
 */

import type { BluetoothState } from "../types.ts";

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
