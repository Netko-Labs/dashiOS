/**
 * The wallpapers Dashi ships (shell/wallpapers/, drawn by generate.ts) and
 * what settings.json's `appearance.wallpaper.path` may name: a bundled
 * wallpaper by its id ("midnight"), or a photo by absolute path. Turning a
 * choice into the compositor's `wallpaper` request is a pure function here;
 * the compositor loads the file and falls back to its built-in gradient when
 * it cannot (comp/src/wallpaper/).
 */

import { join } from "node:path";
import { isPhotoPath } from "../shared/settings/file.ts";
import { type FrameRate, type LiveKeys, type LiveShader, resolveLive } from "./live/choice.ts";

export const WALLPAPER_MODES = ["fill", "fit", "center"] as const;
export type WallpaperMode = (typeof WALLPAPER_MODES)[number];
export const DEFAULT_WALLPAPER_MODE: WallpaperMode = "fill";

export const isWallpaperMode = (value: unknown): value is WallpaperMode => WALLPAPER_MODES.some((mode) => mode === value);

export interface Bundled {
  id: string;
  title: string;
}

/** In the order System Settings shows them; the first is the default, and is what the compositor draws by itself. */
export const BUNDLED: readonly Bundled[] = [
  { id: "dusk", title: "Dusk" },
  { id: "midnight", title: "Midnight" },
  { id: "dawn", title: "Dawn" },
  { id: "mist", title: "Mist" },
  { id: "aurora", title: "Aurora" },
];

export const DEFAULT_WALLPAPER = "dusk";

/** The directory the wallpapers live in, next to the shell's sources. */
export const WALLPAPER_DIR: string = join(import.meta.dir, "..", "..", "wallpapers");

const BUNDLED_ID = /^[a-z][a-z0-9-]{0,31}$/;
/** What `appearance.wallpaper.path` may hold. */
export const isWallpaperRef = (value: unknown): value is string => isPhotoPath(value) || (typeof value === "string" && BUNDLED_ID.test(value));

export const isBundled = (ref: string): boolean => BUNDLED.some((entry) => entry.id === ref);
export const bundledPath = (id: string): string => join(WALLPAPER_DIR, `${id}.png`);
export const thumbnailPath = (id: string): string => join(WALLPAPER_DIR, `${id}.thumb.png`);

/** The choice as the settings hold it: nothing set is the default wallpaper. */
export interface WallpaperChoice extends LiveKeys {
  path?: string | undefined;
  mode: WallpaperMode;
}

/** IPC `wallpaper`: an image file, the built-in gradient, one of the compositor's animated shaders, or a video it plays. */
export type WallpaperRequest =
  | { path: string; mode: WallpaperMode }
  | { gradient: true; mode: WallpaperMode }
  | { shader: LiveShader; fps: FrameRate; mode: WallpaperMode }
  | { video: string; mode: WallpaperMode };

/**
 * The compositor's `wallpaper` request for `choice`: the animated shader or
 * the video when one is chosen, else the still wallpaper. An unknown bundled
 * name is the default.
 */
export function wallpaperRequest(choice: WallpaperChoice, dir: string = WALLPAPER_DIR): WallpaperRequest {
  const { path, mode } = choice;
  const live = resolveLive(choice);
  if (live.wallpaper.kind === "shader") return { shader: live.wallpaper.shader, fps: live.fps, mode };
  if (live.wallpaper.kind === "video") return { video: live.wallpaper.video, mode };
  if (path === undefined || path === DEFAULT_WALLPAPER || !isWallpaperRef(path)) return { gradient: true, mode };
  if (isPhotoPath(path)) return { path, mode };
  return isBundled(path) ? { path: join(dir, `${path}.png`), mode } : { gradient: true, mode };
}

/** The ref the pane shows as selected. */
export const selectedRef = (choice: WallpaperChoice): string => choice.path ?? DEFAULT_WALLPAPER;
