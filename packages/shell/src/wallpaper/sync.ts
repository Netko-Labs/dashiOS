/**
 * Keeps the compositor's wallpaper where settings.json says: sent when it
 * first becomes known and again only when it changes, so a settings file
 * rewritten with the same contents costs the compositor nothing (and a photo
 * is not decoded twice). A load that fails after the compositor accepted the
 * request comes back as a `wallpaper` event; it keeps the built-in gradient.
 */

import type { Compositor } from "../compositor.ts";
import { type WallpaperChoice, wallpaperRequest } from "./catalog.ts";

export class WallpaperSync {
  private sent: string | null = null;
  private paused: boolean | null = null;

  constructor(private readonly compositor: Pick<Compositor, "wallpaper">) {}

  /**
   * Stop or resume whatever the compositor animates, a shader or a video
   * (IPC `wallpaper {paused}`; a paused one schedules no frames). Sent when
   * it changes.
   */
  pause(paused: boolean): void {
    if (paused === this.paused) return;
    this.paused = paused;
    this.compositor.wallpaper({ paused }).catch((error) => {
      this.paused = null;
      console.error("dashi-shell: could not pause the wallpaper:", error instanceof Error ? error.message : error);
    });
  }

  apply(choice: WallpaperChoice): void {
    const request = wallpaperRequest(choice);
    const key = JSON.stringify(request);
    if (key === this.sent) return;
    this.sent = key;
    this.compositor.wallpaper(request).catch((error) => {
      // Not remembered as sent: the next settings change tries again.
      this.sent = null;
      console.error("dashi-shell: the wallpaper stays as it was:", error instanceof Error ? error.message : error);
    });
  }
}

/** Logs a wallpaper that could not be loaded, for whoever reads the session log. */
export function reportWallpaper(event: { ok: boolean; path: string | null; error?: string }): void {
  if (!event.ok) console.error(`dashi-shell: the wallpaper ${event.path ?? ""} did not load (${event.error ?? "unknown reason"}); the wallpaper stays as it was`);
}
