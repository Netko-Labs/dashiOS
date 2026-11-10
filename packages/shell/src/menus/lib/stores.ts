/** What the menus own: the stores Control Center and Settings' machine panes run (devices, Wi-Fi, sound, Bluetooth), and the sheets that ask for a Wi-Fi password, a pairing answer, or a power action. */

import { ownerPids } from "../../app-menus/focus.ts";
import type { AppMenuStore } from "../../app-menus/store.ts";
import { appFor } from "../../apps.ts";
import { placedOutputs } from "../../arrange.ts";
import { PairingPrompt } from "../../bluetooth/prompt.tsx";
import { BluetoothStore } from "../../bluetooth/store.ts";
import { DeviceStore, radiosFor } from "../../control-center/index.ts";
import { holdingBar } from "../../menubar/bar-hold.ts";
import { openOverlay } from "../../overlay.tsx";
import { followOutputVolume, SoundStore, soundBackendFor } from "../../sound/index.ts";
import { run as runCommand } from "../../system/exec.ts";
import { PasswordPrompt } from "../../wifi/prompt.tsx";
import type { WifiStore } from "../../wifi/store.ts";
import type { EntryFor, MenusOptions } from "../options.ts";
import { runPower } from "../session.ts";
import { Dialogs } from "./dialogs.tsx";
import { holdingPlace } from "./holding-place.ts";

export interface MenuStores {
  devices: DeviceStore;
  /** Stops following the volume. */
  stopDevices: () => void;
  wifi: WifiStore;
  audio: ReturnType<typeof soundBackendFor>;
  sound: SoundStore;
  passwords: PasswordPrompt;
  bluetooth: BluetoothStore;
  pairing: PairingPrompt;
}

/** `closeMenus` takes the popover down when a sheet needs the keyboard. */
export function menuStores(options: MenusOptions, closeMenus: () => void): MenuStores {
  const { pipewire } = options;
  // On a development run the radios' switches write to memory, never to the developer's machine.
  const radios = radiosFor({
    standIn: options.wifi.fake || options.bluetooth.fake,
    run: runCommand,
    wifi: options.wifi.radio,
    bluetooth: options.bluetooth.radio,
  });
  const devices = new DeviceStore({
    hotspotRadio: radios.hotspot,
    volumeChanged: (volume) => options.system.publish("volume", volume),
    ...(pipewire?.available ? { followVolume: followOutputVolume(pipewire) } : {}),
    ...(options.brightnessChanged ? { brightnessChanged: options.brightnessChanged } : {}),
    wifiRadio: radios.wifi,
    bluetoothRadio: radios.bluetooth,
    // The Bluetooth radio asks BlueZ itself (and falls back to bluetoothctl, which may be missing).
    hasBluetoothctl: true,
  });
  // The slider follows the volume however it changes (keys, wpctl, another output).
  const stopDevices = devices.start();
  const wifi = options.wifiStore;
  // On a development run the output switch is remembered in memory, never made the default on the developer's machine.
  const audio = soundBackendFor({ standIn: options.wifi.fake, run: runCommand, ...(pipewire ? { watch: pipewire } : {}) });
  const sound = new SoundStore(audio);
  // Sheets that take the keyboard for the app in front: the bar keeps that app meanwhile (bar-hold.ts).
  const passwords = new PasswordPrompt(holdingBar(openOverlay), wifi);
  const bluetooth = new BluetoothStore(options.bluetooth.backend);
  // BlueZ's pairing questions (compare a code, type a PIN) come to the store and show on a sheet.
  options.bluetooth.backend.setPairingHandler(bluetooth);
  const pairing = new PairingPrompt(holdingBar(openOverlay), bluetooth, closeMenus);
  pairing.start();
  return { devices, stopDevices, wifi, audio, sound, passwords, bluetooth, pairing };
}

export function powerDialogs(options: MenusOptions, appMenus: AppMenuStore, entryFor: EntryFor): Dialogs {
  const { compositor } = options;
  return new Dialogs(
    openOverlay,
    runPower,
    compositor
      ? {
          windows: async () =>
            (await compositor.windows())
              .filter((window) => window.pid !== process.pid)
              .map((window) => ({ id: window.id, name: appFor(options.apps, window, entryFor).name })),
          close: async (window) => {
            // The app quits with the session: a question it asks says so ("Quit Terminal?").
            const pid = (await compositor.windows().catch(() => [])).find((each) => each.id === window)?.pid ?? null;
            appMenus.quitting(ownerPids(pid));
            await compositor.close({ window });
          },
          // The log out was cancelled: the app's "Quit Terminal?" or its sheet goes with it.
          withdraw: (window) =>
            void compositor
              .windows()
              .then((windows) => appMenus.stay(ownerPids(windows.find((each) => each.id === window)?.pid ?? null)))
              .catch(() => {}),
          focus: (window) => void compositor.focus({ window }).catch(() => {}),
          place: async (window) => {
            const frame = (await compositor.windows()).find((each) => each.id === window)?.frame ?? null;
            return holdingPlace(frame, placedOutputs(await compositor.outputs()));
          },
        }
      : undefined,
  );
}
