/** Starts the system services the shell shows: the status store and the hardware keys. */

import { watchCharger } from "./charger.ts";
import { HardwareKeys } from "./keys.ts";
import type { Network } from "./network.ts";
import { openOsdSurface } from "./osd-panel.tsx";
import { OsdController } from "./osd-state.ts";
import { SystemStore, systemSources } from "./store.ts";

export interface System {
  /** For the menu bar. */
  store: SystemStore;
  /** For the keymap's hardware key bindings. */
  hardware: HardwareKeys;
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
}

export function startSystem(options: SystemOptions = {}): System {
  const { network } = options;
  const store = network ? new SystemStore({ ...systemSources(), network: async () => network() }, options.monitor ?? (() => () => {})) : new SystemStore();
  const osd = new OsdController(openOsdSurface);
  const hardware = new HardwareKeys({ osd, volumeChanged: (volume) => store.publish("volume", volume) });
  const stopCharger = watchCharger(store, osd);
  store.start();
  return {
    store,
    hardware,
    close() {
      stopCharger();
      store.stop();
      osd.hide();
    },
  };
}
