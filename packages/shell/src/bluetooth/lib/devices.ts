/**
 * From the devices BlueZ knows to the two lists a person picks from: the
 * ones that are theirs (paired, or connected right now) and the ones nearby
 * that could be. Pure, because the order is what the page promises.
 */

import type { BluetoothDevice, RawDevice } from "../types.ts";

/**
 * Signal strength is shown in steps this many dBm wide. A radio's reading
 * jitters by several dBm from one advertisement to the next; sorting on the
 * raw number would swap neighboring rows under the pointer.
 */
export const SIGNAL_STEP = 10;

export const signalStep = (rssi: number | null): number | null => (rssi === null ? null : Math.round(rssi / SIGNAL_STEP) * SIGNAL_STEP);

/** Names compare without regard to case, then exactly (code units, so the order is the same everywhere). */
function byName(a: BluetoothDevice, b: BluetoothDevice): number {
  const [x, y] = [a.name.toLowerCase(), b.name.toLowerCase()];
  if (x !== y) return x < y ? -1 : 1;
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

/** Nearby: the stronger signal first, devices not being heard last, then by name. */
export function compareNearby(a: BluetoothDevice, b: BluetoothDevice): number {
  if (a.signal !== b.signal) {
    if (a.signal === null) return 1;
    if (b.signal === null) return -1;
    return b.signal - a.signal;
  }
  return byName(a, b);
}

/** Mine: connected ones first, then by name. */
export function compareMine(a: BluetoothDevice, b: BluetoothDevice): number {
  if (a.connected !== b.connected) return a.connected ? -1 : 1;
  return byName(a, b);
}

export interface DeviceLists {
  mine: BluetoothDevice[];
  nearby: BluetoothDevice[];
}

export function buildLists(devices: readonly RawDevice[]): DeviceLists {
  const mine: BluetoothDevice[] = [];
  const nearby: BluetoothDevice[] = [];
  for (const device of devices) {
    const row = (name: string): BluetoothDevice => ({
      path: device.path,
      name,
      kind: device.kind,
      paired: device.paired,
      connected: device.connected,
      battery: device.battery,
      signal: signalStep(device.rssi),
    });
    if (device.paired || device.connected) {
      // The person's own name for it, else what it calls itself; the address is the last resort.
      mine.push(row(device.alias ?? device.name ?? device.address));
    } else if (device.name !== null) {
      // A device that announces no name is a beacon or a phone passing by: nothing to pick.
      nearby.push(row(device.name));
    }
  }
  return { mine: mine.sort(compareMine), nearby: nearby.sort(compareNearby) };
}
