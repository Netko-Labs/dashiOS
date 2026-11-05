/**
 * What the machine panes of System Settings (Network, Bluetooth, Sound,
 * Battery & Power, Users & Accounts) read and change. Wi-Fi, Bluetooth, and
 * the sound outputs are the stores Control Center already runs, so a switch
 * flipped in either place is seen in the other; the rest are made here. On a
 * development run every one of them is a stand-in or keeps its writes in
 * memory (system/stand-in.ts), as Wi-Fi and Bluetooth do.
 */

import { AccountStore, type AccountsSetup, chooseAccounts, PasswordChangePrompt } from "../accounts/index.ts";
import type { BatteryMonitor } from "../battery/index.ts";
import type { BluetoothStore } from "../bluetooth/store.ts";
import type { DeviceStore } from "../control-center/devices.ts";
import type { Laptop } from "../laptop/start.ts";
import { fakeNetInfo, NetInfoStore, nmcliNetInfo } from "../network/index.ts";
import { openOverlay } from "../overlay.tsx";
import { fakeLid, logindLid } from "../power/policy.ts";
import { fakeMeter, inputsOf, type LevelMeter, LevelsStore, pipewireMeter, SoundStore, shadowLevels, wpctlLevels } from "../sound/index.ts";
import type { AudioBackend } from "../sound/types.ts";
import { readBatteryDetails } from "../system/battery-details.ts";
import { EnergyStore } from "../system/energy.ts";
import { run } from "../system/exec.ts";
import { powerProfiles, shadowProfiles } from "../system/profiles.ts";
import { type Nesting, standsIn } from "../system/stand-in.ts";
import type { SystemStore } from "../system/store.ts";
import { systemBus } from "../system/system-bus.ts";
import type { WifiStore } from "../wifi/store.ts";
import type { WifiNetwork } from "../wifi/types.ts";

/** The stores Control Center runs, which the panes share (menus/start.tsx hands them over). */
export interface SharedStores {
  wifi: WifiStore;
  devices: DeviceStore;
  bluetooth: BluetoothStore;
  /** The outputs, as Control Center's Sound page lists them. */
  sound: SoundStore;
  audio: AudioBackend;
  /** Asks for a Wi-Fi network's password on its own sheet. */
  askWifiPassword(network: WifiNetwork): void;
}

export interface PaneServices extends SharedStores {
  netinfo: NetInfoStore;
  inputs: SoundStore;
  levels: LevelsStore;
  meter: LevelMeter;
  energy: EnergyStore;
  /** The battery's history, draw, energy users, and insights (battery/); null without one. */
  battery: BatteryMonitor | null;
  /** The power modes, the charge limit, the keyboard light, the graphics card (laptop/); null in tests. */
  laptop: Laptop | null;
  account: AccountStore;
  /** Opens the password sheet; `needsCurrent` asks for the current password first. */
  changePassword(needsCurrent: boolean): void;
  close(): void;
}

export interface ServicesOptions {
  shared: SharedStores;
  system: Pick<SystemStore, "publish">;
  env?: Record<string, string | undefined>;
  nesting?: Nesting;
  /** The accounts to use in place of the chosen ones (tests). */
  accounts?: AccountsSetup;
  /** The shell's battery monitor. */
  battery?: BatteryMonitor | null;
  /** The shell's laptop (laptop/start.ts). */
  laptop?: Laptop | null;
}

export function createPaneServices(options: ServicesOptions): PaneServices {
  const { shared, system } = options;
  const fake = standsIn(options.env ?? process.env, options.nesting);
  const accounts = options.accounts ?? chooseAccounts(options.env ?? process.env, options.nesting);
  const real = wpctlLevels(run);
  const energy = new EnergyStore({
    battery: () => readBatteryDetails(),
    profiles: fake ? shadowProfiles(powerProfiles(systemBus())) : powerProfiles(systemBus()),
    lid: fake ? fakeLid() : logindLid(),
  });
  const prompt = new PasswordChangePrompt(openOverlay, accounts.passwords);
  return {
    ...shared,
    battery: options.battery ?? null,
    laptop: options.laptop ?? null,
    netinfo: new NetInfoStore(fake ? fakeNetInfo() : nmcliNetInfo(run)),
    inputs: new SoundStore(inputsOf(shared.audio)),
    levels: new LevelsStore(fake ? shadowLevels(real) : real, (volume) => system.publish("volume", volume)),
    meter: fake ? fakeMeter() : pipewireMeter(),
    energy,
    account: new AccountStore(accounts.backend),
    changePassword: (needsCurrent) => prompt.ask(needsCurrent),
    close() {
      prompt.close();
      accounts.backend.close();
    },
  };
}
