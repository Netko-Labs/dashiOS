/** Starts the system services the shell shows: the status store and the hardware keys. */

import { watchCharger } from "./charger.ts";
import { HardwareKeys } from "./keys.ts";
import type { Network } from "./network.ts";
import { openOsdSurface } from "./osd-panel.tsx";
import { OsdController } from "./osd-state.ts";
import { type ScreenHost, startScreenDark } from "./screen-dark.ts";
import { SystemStore, systemSources } from "./store.ts";

export interface System {
  /** For the menu bar. */
  store: SystemStore;
  /** For the keymap's hardware key bindings. */
  hardware: HardwareKeys;
  /** The on-screen display, for keys handled elsewhere (the laptop's, laptop/). */
  osd: OsdController;
  /** Brightness changed to `level` (0..1) elsewhere (Control Center): at 0 the built-in screen goes off. */
  brightnessChanged(level: number): void;
  close(): void;
}

export interface SystemOptions {
  /**
   * The network for the menu bar, in place of `nmcli`'s answer (and in place of
   * watching `nmcli monitor`): a development run whose Wi-Fi is a stand-in.
   */
  network?: () => Network;
  /** Calls `onChange` when that network changes, in place of watching `nmcli monitor`. */
  monitor?: (onChange: () => void) => () => void;
  /** dashi-comp, to turn the built-in screen off at brightness 0 (none: the backlight alone). */
  compositor?: ScreenHost | null;
}

export function startSystem(options: SystemOptions = {}): System {
  const { network } = options;
  const store = network ? new SystemStore({ ...systemSources(), network: async () => network() }, options.monitor ?? (() => () => {})) : new SystemStore();
  const osd = new OsdController(openOsdSurface);
  const dark = options.compositor ? startScreenDark(options.compositor) : null;
  const brightnessChanged = (level: number): void => void dark?.then((screen) => screen.follow(level));
  const hardware = new HardwareKeys({ osd, volumeChanged: (volume) => store.publish("volume", volume), brightnessChanged });
  const stopCharger = watchCharger(store, osd);
  store.start();
  return {
    store,
    hardware,
    osd,
    brightnessChanged,
    close() {
      stopCharger();
      store.stop();
      osd.hide();
    },
  };
}
