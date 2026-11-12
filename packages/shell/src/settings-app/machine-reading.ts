/**
 * What agents read from the machine panes' stores, and the changes they may
 * make (machine-desktop.ts): the shapes of the replies and the one lookup by
 * name every change uses.
 */

import type { ProfileId } from "../system/profiles.ts";
import type { Volume } from "../system/volume.ts";

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
  /** Each app playing sound; `output` is "default" or the output's name. */
  apps: AppReading[];
  /** The apps recording, and from which input. */
  recording: RecordingReading[];
}

/** One stream of an app that has several (a browser's tabs). */
export interface StreamReading {
  title: string;
  playing: boolean;
  level: number;
  muted: boolean;
}

export interface AppReading {
  name: string;
  playing: boolean;
  level: number;
  muted: boolean;
  output: string;
  /** Its streams, when it has more than one; else none. */
  streams: StreamReading[];
}

/** An app that records now. */
export interface RecordingReading {
  name: string;
  /** What it records from now: an input's name, or "this computer's sound". */
  input: string;
  /** How much of the input it takes, 0 to 1, and whether it is muted. */
  level: number;
  muted: boolean;
  /** The input chosen for it: "default", or an input's name. */
  recordsFrom: string;
}

export type AppVolumeOutcome = { ok: true; app: AppReading } | { ok: false; reason: "unavailable" | "none" | "many" | "no-output" | "failed" };

export type AppInputOutcome =
  | { ok: true; app: RecordingReading }
  | { ok: false; reason: "unavailable" | "none" | "many" | "no-input" | "own-sound" | "failed" };

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
  /** One app's level, mute, and output (a name from `sound`, or "default"). */
  setAppVolume(app: string, change: { level?: number; muted?: boolean; output?: string }): Promise<AppVolumeOutcome>;
  /** One recording app's level, mute, and input (a name from `sound`, or "default"). */
  setAppInput(app: string, change: { level?: number; muted?: boolean; input?: string }): Promise<AppInputOutcome>;
  power(): Promise<PowerReading>;
  setPowerProfile(id: ProfileId): Promise<"ok" | "unavailable" | "failed">;
  account(): Promise<AccountReading | null>;
}
