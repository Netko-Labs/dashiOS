/**
 * What `appearance.wallpaper` may say about live wallpapers, checked the same
 * way wherever the file is read (settings/settings.ts for the shell, settings-app/
 * store.ts for System Settings). The keys beside the existing `path`, `mode`,
 * and `photos`:
 *
 *   kind            "picture" (the default, and what a file from before live
 *                   wallpapers means), "shader", or "video"
 *   shader          "aurora" | "drift" | "tide": drawn by the compositor
 *   video           an absolute path to a video file, played by the
 *                   compositor (looped, muted); videos lists the ones added
 *   fps             15, 30, or 60: how often a shader draws
 *   pauseOnBattery  stop live wallpapers while on battery (on unless false)
 *
 * `path` stays the still wallpaper under a live one: what shows on the lock
 * screen. Older versions also wrote `kind: "wallpaperengine"` and `workshop`;
 * those read as a picture (RETIRED_KINDS, RETIRED_KEYS) and are never written.
 */

import { isAbsolute } from "node:path";

export const WALLPAPER_KINDS = ["picture", "shader", "video"] as const;
export type WallpaperKind = (typeof WALLPAPER_KINDS)[number];

/** Kinds older versions wrote that Dashi no longer runs: they read as a picture. */
export const RETIRED_KINDS: readonly string[] = ["wallpaperengine"];
/** Keys older versions wrote beside them: read past quietly, never written. */
export const RETIRED_KEYS: readonly string[] = ["workshop"];

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
/** An absolute path to a video file the compositor can play. */
export const isVideoPath = (value: unknown): value is string => typeof value === "string" && VIDEO_PATH.test(value) && isAbsolute(value);
export const isVideoList = (value: unknown): value is string[] => Array.isArray(value) && value.length <= MAX_VIDEOS && value.every(isVideoPath);

/** The live-wallpaper keys of `appearance.wallpaper`, as the settings hold them. */
export interface LiveKeys {
  kind?: WallpaperKind | undefined;
  shader?: LiveShader | undefined;
  video?: string | undefined;
  fps?: FrameRate | undefined;
  pauseOnBattery?: boolean | undefined;
}

/** What is running behind the windows: the one thing a choice comes to. */
export type LiveWallpaper = { kind: "picture" } | { kind: "shader"; shader: LiveShader } | { kind: "video"; video: string };

export interface LiveChoice {
  wallpaper: LiveWallpaper;
  fps: FrameRate;
  pauseOnBattery: boolean;
}

/**
 * The choice the keys come to. A file from before live wallpapers has no
 * `kind` and means a picture; a kind whose item is missing or invalid (or
 * a retired kind) is a picture too, so the desktop never goes without a
 * wallpaper.
 */
export function resolveLive(keys: LiveKeys): LiveChoice {
  const common = { fps: keys.fps ?? DEFAULT_FRAME_RATE, pauseOnBattery: keys.pauseOnBattery ?? true };
  const picture: LiveChoice = { wallpaper: { kind: "picture" }, ...common };
  switch (keys.kind) {
    case "shader":
      return keys.shader !== undefined && isLiveShader(keys.shader) ? { wallpaper: { kind: "shader", shader: keys.shader }, ...common } : picture;
    case "video":
      return keys.video !== undefined && isVideoPath(keys.video) ? { wallpaper: { kind: "video", video: keys.video }, ...common } : picture;
    default:
      return picture;
  }
}
