/**
 * The machine's radios, Wi-Fi and Bluetooth, as a pair of read and write.
 * Writing is what a development run must never do to the developer's own
 * machine, so a radio can be wrapped to keep its writes in memory (see
 * `system/stand-in.ts`), and `radiosFor` is the one place that decides which
 * radios the Control Center switches get.
 */

import { type Run } from "../system/exec.ts";

export interface Radio {
  /** Whether it is on; null when it cannot be asked. */
  read(): Promise<boolean | null>;
  set(on: boolean): Promise<void>;
}

/** `nmcli radio wifi` prints `enabled` or `disabled`. */
export function parseWifiRadio(output: string): boolean | null {
  const text = output.trim();
  return text === "enabled" ? true : text === "disabled" ? false : null;
}

/** `bluetoothctl show` lists `Powered: yes` for the default adapter. */
export function parseBluetoothPower(output: string): boolean | null {
  const match = /^\s*Powered:\s*(yes|no)\s*$/m.exec(output);
  return match ? match[1] === "yes" : null;
}

/** Whether `nmcli -t -f TYPE dev status` lists a Wi-Fi device. */
export function hasWifiDevice(output: string): boolean {
  return output.split("\n").some((line) => line.trim() === "wifi");
}

/**
 * The Wi-Fi radio through `nmcli`. A machine with no Wi-Fi hardware (a
 * desktop on Ethernet, the VM) reads as null, so there is no Wi-Fi switch:
 * NetworkManager's global radio flag is "enabled" even with nothing to turn on.
 */
export function nmcliRadio(run: Run): Radio {
  return {
    read: async () => {
      const devices = await run(["nmcli", "-t", "-f", "TYPE", "dev", "status"]);
      if (devices === null || !hasWifiDevice(devices)) return null;
      const answer = await run(["nmcli", "radio", "wifi"]);
      return answer === null ? null : parseWifiRadio(answer);
    },
    set: async (on) => {
      await run(["nmcli", "radio", "wifi", on ? "on" : "off"]);
    },
  };
}

/** The Bluetooth adapter's power through `bluetoothctl`. */
export function bluetoothRadio(run: Run): Radio {
  return {
    read: async () => {
      const answer = await run(["bluetoothctl", "show"]);
      return answer === null ? null : parseBluetoothPower(answer);
    },
    set: async (on) => {
      await run(["bluetoothctl", "power", on ? "on" : "off"]);
    },
  };
}

/**
 * A radio that reads the real one until it is written, and keeps what it was
 * told from then on: the switch works on screen, and nothing reaches the machine.
 */
export function shadowRadio(real: Radio): Radio {
  let told: boolean | null = null;
  return {
    read: async () => told ?? (await real.read()),
    set: async (on) => {
      told = on;
    },
  };
}

/**
 * The radios the switches use. On a stand-in run the Wi-Fi radio is the
 * stand-in's own (`wifi`), or a shadow of `nmcli` if it has none, and
 * Bluetooth likewise (`bluetooth`, else a shadow: reads real, writes in
 * memory). Off the stand-in a radio that is passed is used as it is (the
 * Bluetooth one goes through BlueZ, with `bluetoothctl` behind it).
 */
export function radiosFor(options: { standIn: boolean; run: Run; wifi?: Radio | null; bluetooth?: Radio | null }): { wifi: Radio; bluetooth: Radio } {
  const { standIn, run } = options;
  const bluetooth = bluetoothRadio(run);
  if (!standIn) return { wifi: options.wifi ?? nmcliRadio(run), bluetooth: options.bluetooth ?? bluetooth };
  return { wifi: options.wifi ?? shadowRadio(nmcliRadio(run)), bluetooth: options.bluetooth ?? shadowRadio(bluetooth) };
}
