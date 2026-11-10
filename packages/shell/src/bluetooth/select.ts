/**
 * Which Bluetooth the shell talks to: BlueZ, or the stand-in.
 *
 * A development run gets the stand-in, never BlueZ, so pairing, connecting,
 * or switching the radio from it cannot touch the developer's own devices
 * (`system/stand-in.ts` says when a run is one, and how to override it, with
 * the same switch Wi-Fi uses).
 */

import { bluetoothRadio, type Radio } from "../control-center/index.ts";
import { run } from "../system/exec.ts";
import { type Nesting, standsIn } from "../system/stand-in.ts";
import { BluezBackend } from "./bluez.ts";
import { FakeBluetooth, type FakeBluetoothOptions } from "./fake.ts";
import { bluezRadio } from "./radio.ts";
import type { BluetoothBackend } from "./types.ts";

/** What the shell is wired to. */
export interface BluetoothSetup {
  backend: BluetoothBackend;
  /** The tile's radio switch: BlueZ with `bluetoothctl` behind it, or the stand-in's own. */
  radio: Radio;
  fake: boolean;
}

export function chooseBluetooth(env: Record<string, string | undefined> = process.env, nesting?: Nesting, standIn: FakeBluetoothOptions = {}): BluetoothSetup {
  if (standsIn(env, nesting)) {
    console.error("dashi-shell: Bluetooth is a stand-in here (this is a development run; DASHI_FAKE_NM=0 uses BlueZ)");
    const fake = new FakeBluetooth(standIn);
    return { backend: fake, radio: fake.radio, fake: true };
  }
  const backend = new BluezBackend();
  return { backend, radio: bluezRadio(backend, bluetoothRadio(run)), fake: false };
}
