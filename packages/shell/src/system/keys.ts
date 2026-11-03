/**
 * The hardware keys' actions: volume, mute, brightness, and media. keymap.ts
 * binds the XF86 keys to these names; shortcuts.ts hands them here. Each
 * press changes the system through its tool and shows the on-screen display.
 */

import { levelOf, stepBrightness } from "./brightness.ts";
import { run as defaultRun, type Run } from "./exec.ts";
import { isMediaKey, pressMedia } from "./media.ts";
import type { OsdState } from "./osd-state.ts";
import { SOURCE, stepVolume, toggleMute, type Volume } from "./volume.ts";

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
}

export class HardwareKeys {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: HardwareDeps) {}

  /**
   * Runs the binding if it is a hardware key (false if it is not). Presses
   * run one after another, so a held key cannot interleave its reads and
   * writes.
   */
  run(name: string): Promise<boolean> {
    if (!HARDWARE_BINDINGS.includes(name)) return Promise.resolve(false);
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
        const volume = await stepVolume(run, name === "volume-up" ? "up" : "down");
        if (volume) this.volume(volume);
        return;
      }
      case "volume-mute": {
        const volume = await toggleMute(run);
        if (volume) this.volume(volume);
        return;
      }
      case "mic-mute": {
        const mic = await toggleMute(run, SOURCE);
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

  private volume(volume: Volume): void {
    this.deps.volumeChanged?.(volume);
    this.deps.osd.show({ kind: "volume", level: volume.level, muted: volume.muted });
  }
}
