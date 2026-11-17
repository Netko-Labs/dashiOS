/**
 * The accent the person picked (settings.json `appearance.accent`; Settings ›
 * Appearance), turned into the one seed every Dashi surface paints from. A
 * preset or a colour is its seed; From wallpaper takes the wallpaper's most
 * colourful common hue (@dashi/ui `seedFromPixels`), read from a 96 × 60
 * still of it, and reads it again only when the wallpaper changes. The seed
 * goes into Control Center's file (shared/control-center/flags.ts `accent`),
 * so the shell and every app's process repaint from it at once, and the
 * outside apps follow it from there (follow.ts).
 */

import { type AccentChoice, isKombu, seedFromPixels, seedOf } from "@dashi/ui";
import type { FlagsStore } from "../shared/control-center/index.ts";
import { type WallpaperChoice, type WallpaperStill, wallpaperStill } from "../wallpaper/index.ts";

/** The still's size: enough to vote, small enough to read at once. */
export const STILL = { width: 96, height: 60 } as const;

/** Packed RGB of a still, `STILL` in size; null when it could not be read. */
export type ReadPixels = (still: WallpaperStill) => Promise<Uint8Array | null>;

const stillKey = (still: WallpaperStill): string => ("image" in still ? `image:${still.image}` : `video:${still.video}`);

/** The command that prints a still's pixels: ImageMagick for a picture, FFmpeg's first frame for a video. */
export function pixelsCommand(still: WallpaperStill): string[] {
  const size = `${STILL.width}x${STILL.height}`;
  if ("image" in still) return ["magick", `${still.image}[0]`, "-resize", `${size}!`, "-depth", "8", "rgb:-"];
  const scale = `scale=${STILL.width}:${STILL.height}`;
  return ["ffmpeg", "-v", "error", "-i", still.video, "-frames:v", "1", "-vf", scale, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"];
}

/** The session's reader: ImageMagick (the dashi package requires it) or FFmpeg, 5 s at most. */
export const readPixels: ReadPixels = async (still) => {
  const command = pixelsCommand(still);
  if (!Bun.which(command[0] ?? "")) return null;
  try {
    const child = Bun.spawn(command, { stdin: "ignore", stdout: "pipe", stderr: "ignore", timeout: 5000 });
    const [bytes, code] = await Promise.all([new Response(child.stdout).arrayBuffer(), child.exited]);
    const rgb = new Uint8Array(bytes);
    return code === 0 && rgb.length >= 3 ? rgb : null;
  } catch {
    return null;
  }
};

export interface AccentSyncDeps {
  flags: Pick<FlagsStore, "getSnapshot" | "set">;
  pixels: ReadPixels;
}

/** Applies the setting: the seed into the flags; the wallpaper's found again only when the wallpaper changes. */
export class AccentSync {
  private reading: { key: string; seed: Promise<string | null> } | null = null;
  private asked = 0;

  constructor(private readonly deps: AccentSyncDeps) {}

  /** Resolves once the seed is in the flags (after reading the wallpaper, when that was needed). */
  async apply(choice: AccentChoice | undefined, wallpaper: WallpaperChoice): Promise<void> {
    const ask = ++this.asked;
    let wallpaperSeed: string | null = null;
    if (choice && "wallpaper" in choice) {
      const still = wallpaperStill(wallpaper);
      const key = stillKey(still);
      if (key !== this.reading?.key) this.reading = { key, seed: this.read(still, key) };
      wallpaperSeed = await this.reading.seed;
      // A newer choice came while the wallpaper was read: that one is applied instead.
      if (ask !== this.asked) return;
    }
    const seed = seedOf(choice, wallpaperSeed);
    this.deps.flags.set({ accent: isKombu(seed) ? undefined : seed });
  }

  private async read(still: WallpaperStill, key: string): Promise<string | null> {
    const rgb = await this.deps.pixels(still);
    const seed = rgb ? seedFromPixels(rgb) : null;
    if (!seed) console.error(`dashi-shell: the accent keeps Kombu: no colour found in the wallpaper (${key})`);
    return seed;
  }
}
