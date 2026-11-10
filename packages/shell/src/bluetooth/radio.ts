/**
 * Control Center's Bluetooth switch, through BlueZ when it can be asked
 * (`Adapter1.Powered`) and through `bluetoothctl` when it cannot (no bus,
 * or bluetoothd not running: the fallback the tile always had).
 */

import type { Radio } from "../control-center/index.ts";
import { classify } from "./failures.ts";
import type { BluetoothBackend } from "./types.ts";

export function bluezRadio(backend: Pick<BluetoothBackend, "read" | "setPower">, fallback: Radio): Radio {
  return {
    read: async () => {
      try {
        const reading = await backend.read();
        // BlueZ answered and there is no adapter: nothing to switch.
        return reading.kind === "ready" ? reading.adapter.powered : null;
      } catch {
        return fallback.read();
      }
    },
    set: async (on) => {
      try {
        await backend.setPower(on);
      } catch (error) {
        // BlueZ was there and refused (rfkill, say): the read afterwards tells the truth. Only a BlueZ we cannot reach is left to `bluetoothctl`.
        if (classify(error) === "unreachable") await fallback.set(on);
      }
    },
  };
}
