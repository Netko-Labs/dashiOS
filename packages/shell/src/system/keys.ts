/**
 * The hardware keys' actions: volume, mute, brightness, and media. keymap.ts
 * binds the XF86 keys to these names; shortcuts.ts hands them here. Each
 * press changes the system through its tool and shows the on-screen display.
 *
 * On a development run (`standIn`) the volume and mute keys read the host's
 * sound and write nothing to it: what a key set is kept here and shown, as
 * Control Center's slider does (control-center/devices.ts). The sound on the
 * machine the developer is using stays as it was.
 */

import { levelOf, stepBrightness } from "./brightness.ts";
import { run as defaultRun, type Run } from "./exec.ts";
import { isMediaKey, pressMedia } from "./lib/media.ts";
import type { OsdState } from "./osd-state.ts";
import { readVolume, SINK, SOURCE, stepped, stepVolume, toggleMute, type Volume } from "./volume.ts";

/** Every binding name this module runs (the media ones are media.ts's). */
export const HARDWARE_BINDINGS: readonly string[] = [
  "volume-up",
  "volume-down",
  "volume-mute",
  "mic-mute",
  "brightness-up",
  "brightness-down",
  "media-play-pause",
  "media-play",
  "media-pause",
  "media-next",
  "media-previous",
];

const flipped = (before: Volume): Volume => ({ ...before, muted: !before.muted });

export interface HardwareDeps {
  run?: Run;
  osd: { show(state: OsdState): void };
  /** The output volume as the keys left it, for the menu bar. */
  volumeChanged?: (volume: Volume) => void;
  /** Where the backlights are, and whether brightnessctl exists (tests). */
  brightness?: { root?: string; hasBrightnessctl?: boolean };
  /** The brightness level (0..1) after a key changed it: at 0 the built-in screen goes off (screen-dark.ts). */
  brightnessChanged?: (level: number) => void;
  hasPlayerctl?: boolean;
  /** A development run: the volume and mute keys write nothing to the machine. */
  standIn?: boolean;
}

export class HardwareKeys {
  private queue: Promise<unknown> = Promise.resolve();
  /** The laptop's own keys (laptop/lib/hotkeys.ts), handed in once the machine is known. */
  private machineKeys: ((name: string) => Promise<boolean>) | null = null;
  /** A development run's output and microphone, once a key set them: shown over the host's from then on. */
  private readonly told = new Map<string, Volume>();

  constructor(private readonly deps: HardwareDeps) {}

  /** Runs this machine's own keys (Fn F5, Fn F4, the ROG key) before the generic ones. */
  setMachineKeys(run: ((name: string) => Promise<boolean>) | null): void {
    this.machineKeys = run;
  }

  /**
   * Runs the binding if it is a hardware key (false if it is not). Presses
   * run one after another, so a held key cannot interleave its reads and
   * writes.
   */
  run(name: string): Promise<boolean> {
    if (!HARDWARE_BINDINGS.includes(name)) return this.machineKeys?.(name) ?? Promise.resolve(false);
    const result = this.queue.then(() => this.perform(name));
    this.queue = result.catch(() => {});
    return result.then(() => true);
  }

  private async perform(name: string): Promise<void> {
    const run = this.deps.run ?? defaultRun;
    if (isMediaKey(name)) {
      await pressMedia(run, name, this.deps.hasPlayerctl);
      return;
    }
    switch (name) {
      case "volume-up":
      case "volume-down": {
        const direction = name === "volume-up" ? "up" : "down";
        const volume = this.deps.standIn ? await this.pretend(run, SINK, (before) => stepped(before, direction)) : await stepVolume(run, direction);
        if (volume) this.volume(volume);
        return;
      }
      case "volume-mute": {
        const volume = this.deps.standIn ? await this.pretend(run, SINK, flipped) : await toggleMute(run);
        if (volume) this.volume(volume);
        return;
      }
      case "mic-mute": {
        const mic = this.deps.standIn ? await this.pretend(run, SOURCE, flipped) : await toggleMute(run, SOURCE);
        if (mic) this.deps.osd.show({ kind: "mic", muted: mic.muted });
        return;
      }
      case "brightness-up":
      case "brightness-down": {
        const light = await stepBrightness(run, name === "brightness-up" ? "up" : "down", this.deps.brightness);
        if (!light) return;
        this.deps.brightnessChanged?.(levelOf(light));
        this.deps.osd.show({ kind: "brightness", level: levelOf(light) });
        return;
      }
    }
  }

  /** A development run's key: `change` made to what was last told (the host's volume, read, the first time), and nothing written. */
  private async pretend(run: Run, target: string, change: (before: Volume) => Volume): Promise<Volume | null> {
    const before = this.told.get(target) ?? (await readVolume(run, target));
    if (before === null) return null;
    const next = change(before);
    this.told.set(target, next);
    return next;
  }

  private volume(volume: Volume): void {
    this.deps.volumeChanged?.(volume);
    this.deps.osd.show({ kind: "volume", level: volume.level, muted: volume.muted });
  }
}
