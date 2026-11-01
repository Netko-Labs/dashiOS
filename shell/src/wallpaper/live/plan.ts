/**
 * What to run for a wallpaper choice, as data. A live wallpaper has two
 * parts: the still wallpaper the compositor draws (what shows before a
 * renderer is up, if it is given up on, and behind the lock screen) and,
 * for a video or a Wallpaper Engine item, the renderer on top. A choice that
 * cannot be carried out (the item was deleted, Wallpaper Engine's assets or
 * the renderer are missing) is the still wallpaper alone, with a note for the log.
 */

import type { WallpaperChoice } from "../catalog.ts";
import { type LiveChoice, resolveLive } from "./choice.ts";
import type { RendererSpec } from "./renderer.ts";
import { isPlayable } from "./workshop.ts";
import type { WorkshopItem } from "./project.ts";

export interface World {
  /** Wallpaper Engine's Workshop items. */
  items: readonly WorkshopItem[];
  /** Wallpaper Engine's assets folder, or null. */
  assets: string | null;
  /** linux-wallpaperengine, or null when it is not installed. */
  bin: string | null;
  /** A project folder for a video file; null if one cannot be made. */
  videoProject(video: string): string | null;
  /** An empty assets folder for videos. */
  stubAssets(): string;
}

export interface Plan {
  /** What goes to the compositor: the still wallpaper, or its animated shader. */
  sync: WallpaperChoice;
  /** The renderer to run on each screen, or null for none. */
  renderer: RendererSpec | null;
  /** Why a live choice is not running, for the log. */
  note: string | null;
  live: LiveChoice;
}

/** A still image the compositor can decode: PNG or JPEG. */
const isStill = (path: string): boolean => /\.(?:png|jpe?g)$/i.test(path);

export function planWallpaper(choice: WallpaperChoice, world: World): Plan {
  const live = resolveLive(choice);
  const picture = (path: string | undefined, note: string | null = null): Plan => ({
    sync: { ...choice, kind: "picture", path },
    renderer: null,
    note,
    live,
  });
  switch (live.wallpaper.kind) {
    case "picture":
      return picture(choice.path);
    case "shader":
      return { sync: choice, renderer: null, note: null, live };
    case "video": {
      if (world.bin === null) return picture(choice.path, "video wallpapers need linux-wallpaperengine, which is not installed");
      const project = world.videoProject(live.wallpaper.video);
      if (project === null) return picture(choice.path, "could not prepare the video wallpaper");
      return {
        sync: { ...choice, kind: "picture" },
        renderer: { bin: world.bin, project, assets: world.assets ?? world.stubAssets(), fps: live.fps, scaling: "fill" },
        note: null,
        live,
      };
    }
    case "wallpaperengine": {
      const { workshop } = live.wallpaper;
      const item = world.items.find((candidate) => candidate.id === workshop);
      if (item === undefined) return picture(choice.path, `Wallpaper Engine item ${workshop} is not in Steam's Workshop folder`);
      // The item's own picture is the still when it is one the compositor can decode.
      const still = item.preview !== null && isStill(item.preview) ? item.preview : choice.path;
      if (world.bin === null) return picture(still, "Wallpaper Engine items need linux-wallpaperengine, which is not installed");
      if (!isPlayable(item, world.assets)) return picture(still, "Install Wallpaper Engine in Steam to use its wallpapers (its assets folder is missing)");
      return {
        sync: { ...choice, kind: "picture", path: still },
        // A video item does not use the assets, but the renderer wants a folder that exists.
        renderer: { bin: world.bin, project: item.dir, assets: world.assets ?? world.stubAssets(), fps: live.fps, scaling: "default" },
        note: null,
        live,
      };
    }
  }
}
