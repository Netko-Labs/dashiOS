/**
 * What `appearance.wallpaper` may say about live wallpapers, checked the same
 * way wherever the file is read (settings.ts for the shell, settings-app/
 * store.ts for System Settings). The keys beside the existing `path`, `mode`,
 * and `photos`:
 *
 *   kind            "picture" (the default, and what a file from before live
 *                   wallpapers means), "shader", "video", or "wallpaperengine"
 *   shader          "aurora" | "drift" | "tide": drawn by the compositor
 *   video           an absolute path to an MP4/WebM; videos lists the ones added
 *   workshop        a Wallpaper Engine item's Steam Workshop id
 *   fps             15, 30, or 60: how often a live wallpaper draws
 *   pauseOnBattery  stop live wallpapers while on battery (on unless false)
 *
 * `path` stays the still wallpaper under a live one: what shows behind a
 * video that has not started, and on the lock screen.
 */

import { isAbsolute } from "node:path";

export const WALLPAPER_KINDS = ["picture", "shader", "video", "wallpaperengine"] as const;
export type WallpaperKind = (typeof WALLPAPER_KINDS)[number];

export interface LiveShaderInfo {
  id: LiveShader;
  title: string;
}
export type LiveShader = "aurora" | "drift" | "tide";
/** In the order Settings shows them; ids are the compositor's names (comp/src/wallpaper/live.rs). */
export const LIVE_SHADERS: readonly LiveShaderInfo[] = [
  { id: "aurora", title: "Northern Lights" },
  { id: "drift", title: "Drift" },
  { id: "tide", title: "Tide" },
];

export const FRAME_RATES = [15, 30, 60] as const;
export type FrameRate = (typeof FRAME_RATES)[number];
export const DEFAULT_FRAME_RATE: FrameRate = 30;

/** How many added videos the file keeps. */
export const MAX_VIDEOS = 24;

export const isWallpaperKind = (value: unknown): value is WallpaperKind => WALLPAPER_KINDS.some((kind) => kind === value);
export const isLiveShader = (value: unknown): value is LiveShader => LIVE_SHADERS.some((shader) => shader.id === value);
export const isFrameRate = (value: unknown): value is FrameRate => FRAME_RATES.some((rate) => rate === value);

const VIDEO_PATH = /^\/[^\0-\x1f\x7f]{1,4095}\.(?:mp4|m4v|webm|mkv|mov)$/i;
/** An absolute path to a video file the renderer can play. */
export const isVideoPath = (value: unknown): value is string => typeof value === "string" && VIDEO_PATH.test(value) && isAbsolute(value);
export const isVideoList = (value: unknown): value is string[] => Array.isArray(value) && value.length <= MAX_VIDEOS && value.every(isVideoPath);

/** A Steam Workshop id: only digits, so it can name a folder and nothing else. */
export const isWorkshopId = (value: unknown): value is string => typeof value === "string" && /^[0-9]{1,20}$/.test(value);

/** The live-wallpaper keys of `appearance.wallpaper`, as the settings hold them. */
export interface LiveKeys {
  kind?: WallpaperKind | undefined;
  shader?: LiveShader | undefined;
  video?: string | undefined;
  workshop?: string | undefined;
  fps?: FrameRate | undefined;
  pauseOnBattery?: boolean | undefined;
}

/** What is running behind the windows: the one thing a choice comes to. */
export type LiveWallpaper =
  | { kind: "picture" }
  | { kind: "shader"; shader: LiveShader }
  | { kind: "video"; video: string }
  | { kind: "wallpaperengine"; workshop: string };

export interface LiveChoice {
  wallpaper: LiveWallpaper;
  fps: FrameRate;
  pauseOnBattery: boolean;
}

/**
 * The choice the keys come to. A file from before live wallpapers has no
 * `kind` and means a picture; a kind whose item is missing or invalid is a
 * picture too, so the desktop never goes without a wallpaper.
 */
export function resolveLive(keys: LiveKeys): LiveChoice {
  const common = { fps: keys.fps ?? DEFAULT_FRAME_RATE, pauseOnBattery: keys.pauseOnBattery ?? true };
  const picture: LiveChoice = { wallpaper: { kind: "picture" }, ...common };
  switch (keys.kind) {
    case "shader":
      return keys.shader !== undefined && isLiveShader(keys.shader) ? { wallpaper: { kind: "shader", shader: keys.shader }, ...common } : picture;
    case "video":
      return keys.video !== undefined && isVideoPath(keys.video) ? { wallpaper: { kind: "video", video: keys.video }, ...common } : picture;
    case "wallpaperengine":
      return keys.workshop !== undefined && isWorkshopId(keys.workshop) ? { wallpaper: { kind: "wallpaperengine", workshop: keys.workshop }, ...common } : picture;
    default:
      return picture;
  }
}
