/**
 * Network, Bluetooth, sound, power, and the account as agents reach them:
 * the same stores the machine panes of System Settings use, so what an agent
 * changes is what the person sees there. What is here is chosen for being safe
 * to hand over: reads of the state, and changes the person could undo with a
 * click (the sound output and volume, the power mode, connecting a device they
 * already paired). Not here, on purpose: passwords of any kind, pairing,
 * forgetting a network or a device, VPN switches, automatic login, and the
 * microphone's level meter (which would be a way to listen).
 */

import { describeAction } from "../power/policy.ts";
import { describeBattery } from "../system/battery-details.ts";
import { isProfileId, PROFILE_LABEL, type ProfileId } from "../system/profiles.ts";
import type { Volume } from "../system/volume.ts";
import type { PaneServices } from "./services.ts";
import { DEFAULT_BLANK_AFTER, type SettingsStore } from "./store.ts";

/** One of several things matching a name: exactly one, none, or too many to choose between. */
export type Pick<T> = { kind: "one"; item: T } | { kind: "none" } | { kind: "many" };

/** The item called `name`: an exact match (ignoring case) must be unique. A name is data from the system, never an instruction. */
export function pickByName<T>(items: readonly T[], name: string, nameOf: (item: T) => string): Pick<T> {
  const wanted = name.trim().toLowerCase();
  const matches = items.filter((item) => nameOf(item).toLowerCase() === wanted);
  if (matches.length === 1 && matches[0] !== undefined) return { kind: "one", item: matches[0] };
  return matches.length === 0 ? { kind: "none" } : { kind: "many" };
}

export interface NetworkReading {
  wifi: { available: boolean; current: string | null; known: string[] };
  ethernet: Array<{ connected: boolean; address: string | null; router: string | null; dns: string[] }>;
  vpns: Array<{ name: string; connected: boolean; kind: "vpn" | "wireguard" }>;
}

export interface BluetoothReading {
  available: boolean;
  powered: boolean;
  devices: Array<{ name: string; kind: string; connected: boolean; battery: number | null }>;
}

export type ConnectionOutcome = { ok: true; changed: boolean } | { ok: false; reason: "none" | "many" | "off" | "failed" };

export interface SoundReading {
  outputs: Array<{ name: string; current: boolean }>;
  inputs: Array<{ name: string; current: boolean }>;
  outputVolume: Volume | null;
  inputVolume: Volume | null;
  showInMenuBar: boolean;
}

export type OutputOutcome = { ok: true; name: string; changed: boolean } | { ok: false; reason: "none" | "many" | "failed" };

export interface PowerReading {
  battery: { percent: number; state: string; health: number | null; cycles: number | null } | null;
  powerMode: { active: ProfileId; label: string; available: Array<{ id: ProfileId; label: string }> } | null;
  displayOffAfterMinutes: number;
  sleepAfterMinutes: number;
  lid: { onBattery: string; onPower: string; withDisplay: string } | null;
  percentageInMenuBar: boolean;
}

export interface AccountReading {
  userName: string;
  fullName: string;
  administrator: boolean;
  automaticLogin: boolean;
  hasPicture: boolean;
}

export interface MachineDesktop {
  network(): Promise<NetworkReading>;
  bluetooth(): Promise<BluetoothReading>;
  setBluetoothConnection(name: string, connected: boolean): Promise<ConnectionOutcome>;
  sound(): Promise<SoundReading>;
  setSoundOutput(name: string): Promise<OutputOutcome>;
  /** Null when there is no such device to set. */
  setVolume(target: "output" | "input", change: { level?: number; muted?: boolean }): Promise<Volume | null>;
  power(): Promise<PowerReading>;
  setPowerProfile(id: ProfileId): Promise<"ok" | "unavailable" | "failed">;
  account(): Promise<AccountReading | null>;
}

const minutes = (seconds: number): number => Math.round(seconds / 60);

/** `services` is asked for on each call: the panes' stores are made when first needed. */
export function machineDesktop(services: () => PaneServices, settings: SettingsStore): MachineDesktop {
  return {
    async network() {
      const { wifi, netinfo } = services();
      await Promise.all([wifi.refresh(), netinfo.refresh()]);
      const wifiState = wifi.getSnapshot();
      const info = netinfo.getSnapshot();
      return {
        wifi: { available: wifiState.available === true, current: wifiState.current?.ssid ?? null, known: wifiState.saved.map((saved) => saved.ssid) },
        // The MAC address stays with the person: it is a fingerprint, and nothing an agent does needs it.
        ethernet: info.ethernet.map((device) => ({ connected: device.connected, address: device.address, router: device.router, dns: device.dns })),
        vpns: info.vpns.map((vpn) => ({ name: vpn.name, connected: vpn.active, kind: vpn.kind })),
      };
    },

    async bluetooth() {
      const { bluetooth } = services();
      await bluetooth.refresh();
      const state = bluetooth.getSnapshot();
      return {
        available: state.available === true,
        powered: state.powered,
        devices: state.mine.map((device) => ({ name: device.name, kind: device.kind, connected: device.connected, battery: device.battery })),
      };
    },

    async setBluetoothConnection(name, connected) {
      const { bluetooth } = services();
      await bluetooth.refresh();
      const state = bluetooth.getSnapshot();
      if (state.available !== true || !state.powered) return { ok: false, reason: "off" };
      const found = pickByName(state.mine, name, (device) => device.name);
      if (found.kind !== "one") return { ok: false, reason: found.kind };
      if (found.item.connected === connected) return { ok: true, changed: false };
      const result = await (connected ? bluetooth.connect(found.item) : bluetooth.disconnect(found.item));
      // The page would show why; an agent only needs to know it did not work.
      bluetooth.dismissFailure();
      return result.ok ? { ok: true, changed: true } : { ok: false, reason: "failed" };
    },

    async sound() {
      const { sound, inputs, levels } = services();
      await Promise.all([sound.refresh(), inputs.refresh(), levels.refresh()]);
      const volumes = levels.getSnapshot();
      const names = (list: ReturnType<typeof sound.getSnapshot>["outputs"]) => list.map((device) => ({ name: device.label, current: device.current }));
      return {
        outputs: names(sound.getSnapshot().outputs),
        inputs: names(inputs.getSnapshot().outputs),
        outputVolume: volumes.output,
        inputVolume: volumes.input,
        showInMenuBar: settings.getSnapshot().data.menuBar.sound ?? true,
      };
    },

    async setSoundOutput(name) {
      const { sound } = services();
      await sound.refresh();
      const found = pickByName(sound.getSnapshot().outputs, name, (device) => device.label);
      if (found.kind !== "one") return { ok: false, reason: found.kind };
      if (found.item.current) return { ok: true, name: found.item.label, changed: false };
      await sound.choose(found.item.id);
      const state = sound.getSnapshot();
      if (state.failed !== null) return { ok: false, reason: "failed" };
      return { ok: true, name: found.item.label, changed: true };
    },

    async setVolume(target, change) {
      const { levels } = services();
      await levels.refresh();
      if (levels.getSnapshot()[target] === null) return null;
      if (change.level !== undefined) await levels.setLevel(target, change.level);
      if (change.muted !== undefined) await levels.setMuted(target, change.muted);
      return levels.getSnapshot()[target];
    },

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
