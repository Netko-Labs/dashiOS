/**
 * What Control Center changes on the machine: the Wi-Fi and Bluetooth
 * radios, the screen's brightness, and the output volume. A missing tool or
 * device is `null` for that part (and the part is not shown), never an
 * error: a desktop with no Bluetooth still has a Control Center.
 *
 * Switches and sliders update the store at once and write behind: the
 * radios are read back afterwards, the sliders' writes coalesce. The volume
 * also follows PipeWire as it changes (the session's `pw-dump --monitor`),
 * so a change made elsewhere (a key, `wpctl`, another output) shows at once.
 *
 * On a development run (`standIn`) the volume is read from the host but the
 * slider's level is only kept here, never written to the developer's
 * machine: the same rule as Settings' sliders (sound/levels.ts
 * `shadowLevels`) and the radios (radios.ts). Once the slider has set a
 * level, it reads as that for the rest of the run.
 */

import { useSyncExternalStore } from "react";
import { type Backlight, levelOf, readBacklight, setBrightness } from "../system/brightness.ts";
import { run as defaultRun, hasProgram, type Run } from "../system/exec.ts";
import { readVolume, setVolume, type Volume } from "../system/volume.ts";
import { VolumeFollow } from "../system/volume-follow.ts";
import { latestWins } from "./lib/coalesce.ts";
import { bluetoothRadio, nmcliRadio, type Radio } from "./radios.ts";

export interface Devices {
  /** The Wi-Fi radio; null when NetworkManager cannot be asked. */
  wifi: boolean | null;
  /** The Bluetooth adapter's power; null without bluetoothctl or an adapter. */
  bluetooth: boolean | null;
  /** 0 to 1; null without a backlight (or brightnessctl to set it). */
  brightness: number | null;
  /** The output volume; null without PipeWire. */
  volume: Volume | null;
  /** Personal Hotspot; null without Wi-Fi. */
  hotspot: boolean | null;
}

export interface DeviceDeps {
  run?: Run;
  /** The Wi-Fi radio; `nmcli` by default. */
  wifiRadio?: Radio;
  /** The Bluetooth adapter; `bluetoothctl` by default. */
  bluetoothRadio?: Radio;
  /** Personal Hotspot; none by default (it is read as missing). */
  hotspotRadio?: Radio;
  /** Where the backlights are (tests). */
  backlightRoot?: string;
  hasBluetoothctl?: boolean;
  hasBrightnessctl?: boolean;
  /** The brightness level (0..1) after the slider set it: at 0 the built-in screen goes off (system/lib/screen-dark.ts). */
  brightnessChanged?: (level: number) => void;
  /** The volume after a slider change, for the menu bar's glyph. */
  volumeChanged?: (volume: Volume) => void;
  /** Tells the output volume each time PipeWire changes (sound/apps/watch.ts). Returns the stop. */
  followVolume?: (onVolume: (volume: Volume | null) => void) => () => void;
  /** A development run: the volume slider writes nothing to the machine. */
  standIn?: boolean;
}

export class DeviceStore {
  private snapshot: Devices = { wifi: null, bluetooth: null, brightness: null, volume: null, hotspot: null };
  private light: Backlight | null = null;
  /** The sink was muted when the slider moved up: the next write unmutes it. */
  private pendingUnmute = false;
  /** A development run's volume, once the slider set it: shown over the host's from then on. */
  private told: Volume | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly run: Run;
  private readonly radio: Radio;
  private readonly adapter: Radio;
  private readonly writeBrightness = latestWins((level: number) => this.setBacklight(level));
  private readonly writeVolume = latestWins((level: number) => this.setSink(level));
  /** PipeWire's word on the volume, held a moment after the slider set it. */
  private readonly volumeFollow = new VolumeFollow((volume) => this.publish({ volume }));
  private stopFollow: (() => void) | null = null;

  constructor(private readonly deps: DeviceDeps = {}) {
    this.run = deps.run ?? defaultRun;
    this.radio = deps.wifiRadio ?? nmcliRadio(this.run);
    this.adapter = deps.bluetoothRadio ?? bluetoothRadio(this.run);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): Devices => this.snapshot;

  /** Follows the volume until the returned stop (with `followVolume`). */
  start(): () => void {
    this.stopFollow ??=
      this.deps.followVolume?.((volume) => {
        if (this.told === null) this.volumeFollow.heard(volume);
      }) ?? null;
    return () => {
      this.stopFollow?.();
      this.stopFollow = null;
      this.volumeFollow.stop();
    };
  }

  /** Reads everything again (Control Center just opened). */
  async refresh(): Promise<void> {
    const bluetooth = this.deps.hasBluetoothctl ?? hasProgram("bluetoothctl");
    const brightnessctl = this.deps.hasBrightnessctl ?? hasProgram("brightnessctl");
    const [wifi, bluetoothPower, light, volume, hotspot] = await Promise.all([
      this.radio.read(),
      bluetooth ? this.adapter.read() : Promise.resolve(null),
      brightnessctl ? readBacklight(this.deps.backlightRoot) : Promise.resolve(null),
      readVolume(this.run),
      this.deps.hotspotRadio?.read() ?? Promise.resolve(null),
    ]);
    this.light = light;
    this.publish({
      wifi,
      bluetooth: bluetoothPower,
      brightness: light ? levelOf(light) : null,
      volume: this.told ?? volume,
      hotspot,
    });
  }

  async setHotspot(on: boolean): Promise<void> {
    const radio = this.deps.hotspotRadio;
    if (!radio) return;
    this.publish({ hotspot: on });
    await radio.set(on);
    this.publish({ hotspot: await radio.read() });
  }

  async setWifi(on: boolean): Promise<void> {
    this.publish({ wifi: on });
    await this.radio.set(on);
    this.publish({ wifi: await this.radio.read() });
  }

  async setBluetooth(on: boolean): Promise<void> {
    this.publish({ bluetooth: on });
    await this.adapter.set(on);
    this.publish({ bluetooth: await this.adapter.read() });
  }

  setBrightnessLevel(level: number): void {
    if (!this.light) return;
    this.publish({ brightness: Math.min(Math.max(level, 0), 1) });
    this.writeBrightness(level);
  }

  setVolumeLevel(level: number): void {
    const volume = this.snapshot.volume;
    if (!volume) return;
    if (volume.muted && level > 0) this.pendingUnmute = true;
    const shown = { level: Math.min(Math.max(level, 0), 1), muted: volume.muted && level <= 0 };
    if (this.deps.standIn) {
      this.pendingUnmute = false;
      this.told = shown;
      this.publish({ volume: shown });
      this.deps.volumeChanged?.(shown);
      return;
    }
    this.volumeFollow.set(shown);
    this.publish({ volume: shown });
    this.writeVolume(level);
  }

  private async setBacklight(level: number): Promise<void> {
    if (this.light && (await setBrightness(this.run, this.light, level))) this.deps.brightnessChanged?.(Math.min(Math.max(level, 0), 1));
  }

  private async setSink(level: number): Promise<void> {
    const unmute = this.pendingUnmute;
    this.pendingUnmute = false;
    const volume = await setVolume(this.run, level, unmute);
    if (volume) this.deps.volumeChanged?.(volume);
  }

  private publish(change: Partial<Devices>): void {
    const next = { ...this.snapshot, ...change };
    if (JSON.stringify(next) === JSON.stringify(this.snapshot)) return;
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
}

export function useDevices(store: DeviceStore): Devices {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
