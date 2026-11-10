/**
 * What dashi-comp draws round and dark (IPC `chrome {dark?, radius?,
 * reduceMotion?}`): the title bars follow Dark Mode, every window's corners
 * follow the Appearance setting, and so do the window animations (Reduce
 * motion). Each is sent when it first becomes known and again only
 * when it changes, so a settings file that is rewritten with the same
 * contents costs the compositor nothing.
 */

import type { Compositor } from "../compositor/index.ts";
import { CORNER_RADIUS, type CornerName } from "../shared/appearance/index.ts";

export class ChromeStyle {
  private dark: boolean | null = null;
  private radius: number | null = null;
  private reduceMotion: boolean | null = null;

  constructor(private readonly compositor: Pick<Compositor, "chrome">) {}

  setDark(dark: boolean): void {
    if (dark === this.dark) return;
    this.dark = dark;
    this.send({ dark }, "title bars keep their colors");
  }

  setCorners(corners: CornerName): void {
    const radius = CORNER_RADIUS[corners];
    if (radius === this.radius) return;
    this.radius = radius;
    this.send({ radius }, "windows keep their corners");
  }

  setReduceMotion(reduceMotion: boolean): void {
    if (reduceMotion === this.reduceMotion) return;
    this.reduceMotion = reduceMotion;
    this.send({ reduceMotion }, "windows keep their animations");
  }

  private send(params: { dark: boolean } | { radius: number } | { reduceMotion: boolean }, consequence: string): void {
    this.compositor.chrome(params).catch((error) => console.error(`dashi-shell: ${consequence}:`, error));
  }
}
