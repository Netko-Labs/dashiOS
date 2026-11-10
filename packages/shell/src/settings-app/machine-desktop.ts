/**
 * Network, Bluetooth, sound, power, and the account as agents reach them:
 * the same stores the machine panes of System Settings use, so what an agent
 * changes is what the person sees there. What is here is chosen for being safe
 * to hand over: reads of the state, and changes the person could undo with a
 * click (the sound output and volume, an app's volume, mute and output, the
 * power mode, connecting a device they already paired). Not here, on purpose: passwords of any kind, pairing,
 * forgetting a network or a device, VPN switches, automatic login, and the
 * microphone's level meter (which would be a way to listen).
 */

import { describeAction } from "../power/policy.ts";
import { describeBattery } from "../system/battery-details.ts";
import { isProfileId, PROFILE_LABEL } from "../system/profiles.ts";
import { networkMethods } from "./machine-network.ts";
import type { MachineDesktop } from "./machine-reading.ts";
import { soundMethods } from "./machine-sound.ts";
import type { PaneServices } from "./services.ts";
import { DEFAULT_BLANK_AFTER, type SettingsStore } from "./store.ts";

export type {
  AccountReading,
  AppReading,
  AppVolumeOutcome,
  BluetoothReading,
  ConnectionOutcome,
  MachineDesktop,
  NetworkReading,
  OutputOutcome,
  Pick,
  PowerReading,
  SoundReading,
} from "./machine-reading.ts";
export { pickByName } from "./machine-reading.ts";

const minutes = (seconds: number): number => Math.round(seconds / 60);

/** `services` is asked for on each call: the panes' stores are made when first needed. */
export function machineDesktop(services: () => PaneServices, settings: SettingsStore): MachineDesktop {
  return {
    ...networkMethods(services),
    ...soundMethods(services, settings),

    async power() {
      const { energy } = services();
      await energy.refresh();
      const state = energy.getSnapshot();
      const { idle, menuBar } = settings.getSnapshot().data;
      return {
        battery: state.battery
          ? { percent: state.battery.percent, state: describeBattery(state.battery), health: state.battery.health, cycles: state.battery.cycles }
          : null,
        powerMode: state.profiles
          ? {
              active: state.profiles.active,
              label: PROFILE_LABEL[state.profiles.active],
              available: state.profiles.available.map((id) => ({ id, label: PROFILE_LABEL[id] })),
            }
          : null,
        displayOffAfterMinutes: minutes(idle.blankAfterSeconds ?? DEFAULT_BLANK_AFTER),
        sleepAfterMinutes: minutes(idle.sleepAfterSeconds ?? 0),
        lid: state.lid
          ? { onBattery: describeAction(state.lid.lid), onPower: describeAction(state.lid.lidExternalPower), withDisplay: describeAction(state.lid.lidDocked) }
          : null,
        percentageInMenuBar: menuBar.batteryPercent ?? false,
      };
    },

    async setPowerProfile(id) {
      const { energy } = services();
      await energy.refresh();
      const { profiles } = energy.getSnapshot();
      if (!profiles || !isProfileId(id) || !profiles.available.includes(id)) return "unavailable";
      const ok = await energy.setProfile(id);
      return ok ? "ok" : "failed";
    },

    async account() {
      const { account } = services();
      await account.refresh();
      const current = account.getSnapshot().account;
      if (!current) return null;
      return {
        userName: current.userName,
        fullName: current.realName,
        administrator: current.administrator,
        automaticLogin: current.automaticLogin,
        hasPicture: current.iconFile !== null,
      };
    },
  };
}
