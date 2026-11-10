/**
 * Brightness at 0 turns the built-in screen off, as on a Mac. A backlight
 * at 0 isn't always dark: an OLED panel (the Zephyrus G14's) or amdgpu's
 * minimum keeps it faintly lit. So at 0 the shell also asks dashi-comp to
 * hold the built-in screen (eDP, LVDS, DSI) dark (`power {on: false,
 * output}`), and lights it again as soon as brightness rises (the keys or
 * Control Center's slider). Waking from idle lights every other screen and
 * leaves a held one dark; external screens are never touched.
 */

import type { Compositor, Output } from "../compositor/index.ts";
import { readBacklight } from "./brightness.ts";

/** The compositor client's side this uses (and a test fakes). */
export interface ScreenHost {
  outputs: Compositor["outputs"];
  power: Compositor["power"];
}

/** A laptop's own panel, by its connector name. */
export const isBuiltin = (name: string): boolean => /^(eDP|LVDS|DSI)-/.test(name);

/** The built-in screens' names in an `outputs` answer. */
export function builtinScreens(outputs: readonly Output[]): string[] {
  return outputs.flatMap((output) => (isBuiltin(output.name) ? [output.name] : []));
}

export class ScreenDark {
  /** Whether the built-in screens are held dark, as far as this shell knows. */
  private dark: boolean;
  private queue: Promise<void> = Promise.resolve();
  private warned = false;

  /**
   * `startsDark`: the backlight was at 0 when the shell started, so a
   * screen an earlier shell held dark is lit by the first rise.
   */
  constructor(
    private readonly host: ScreenHost,
    startsDark = false,
  ) {
    this.dark = startsDark;
  }

  /** The backlight is now at `level` (0..1). Calls run one after another. */
  follow(level: number): Promise<void> {
    const next = this.queue.then(() => this.apply(level));
    this.queue = next.catch(() => {});
    return next;
  }

  private async apply(level: number): Promise<void> {
    const off = level <= 0;
    if (off === this.dark) return;
    this.dark = off;
    try {
      const names = builtinScreens(await this.host.outputs());
      for (const output of names) await this.host.power({ on: !off, output });
    } catch (error) {
      if (!this.warned)
        console.error("dashi-shell: turning the built-in screen", off ? "off" : "on", "failed:", error instanceof Error ? error.message : error);
      this.warned = true;
    }
  }
}

/** A ScreenDark that knows whether the backlight starts at 0. */
export async function startScreenDark(host: ScreenHost, root?: string): Promise<ScreenDark> {
  const light = await readBacklight(root);
  return new ScreenDark(host, light !== null && light.value === 0);
}
