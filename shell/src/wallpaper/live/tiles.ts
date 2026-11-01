/**
 * What System Settings' Live section lists, and what choosing each tile
 * writes: pure functions over what discovery found and what the settings
 * hold, so the pane only draws.
 */

import { basename, extname, join } from "node:path";
import { MAX_VIDEOS, type LiveKeys, LIVE_SHADERS } from "./choice.ts";
import { findRenderer } from "./renderer.ts";
import { type Discovery, discoverWorkshop, isPlayable } from "./workshop.ts";
import { homedir } from "node:os";
import { WALLPAPER_DIR } from "../catalog.ts";

export interface LiveScan {
  discovery: Discovery;
  /** linux-wallpaperengine is installed. */
  hasRenderer: boolean;
}

/** Looks at Steam and for the renderer; Settings does it when the pane opens. */
export function scanLive(home: string = homedir(), env: Record<string, string | undefined> = process.env): LiveScan {
  return { discovery: discoverWorkshop(home, env), hasRenderer: findRenderer(join(import.meta.dir, "..", "..", ".."), env) !== null };
}

export interface LiveTile {
  /** Unique across the section: `shader:aurora`, `video:/path`, `we:1845706469`. */
  ref: string;
  title: string;
  /** A picture for the tile; null draws a plain one with the title. */
  image: string | null;
  /** Why it cannot be chosen, or null. */
  problem: string | null;
}

export const thumbnailFor = (shader: string): string => join(WALLPAPER_DIR, `live-${shader}.thumb.png`);

export function shaderTiles(): LiveTile[] {
  return LIVE_SHADERS.map((shader) => ({ ref: `shader:${shader.id}`, title: shader.title, image: thumbnailFor(shader.id), problem: null }));
}

/** The Workshop items, each with why it cannot play when it cannot. */
export function engineTiles(scan: LiveScan): LiveTile[] {
  const { items, assets } = scan.discovery;
  return items.map((item) => ({
    ref: `we:${item.id}`,
    title: item.title,
    image: item.preview,
    problem: !scan.hasRenderer
      ? "Needs linux-wallpaperengine"
      : isPlayable(item, assets)
        ? null
        : "Needs Wallpaper Engine's assets",
  }));
}

/** The videos the person added (newest first), named by their files. */
export function videoTiles(videos: readonly string[], exists: (path: string) => boolean, hasRenderer: boolean): LiveTile[] {
  return videos
    .filter(exists)
    .map((path) => ({ ref: `video:${path}`, title: basename(path, extname(path)), image: null, problem: hasRenderer ? null : "Needs linux-wallpaperengine" }));
}

/** `videos` with `path` first, once, and no more than the file keeps. */
export const withVideo = (videos: readonly string[], path: string): string[] => [path, ...videos.filter((video) => video !== path)].slice(0, MAX_VIDEOS);

/** The tile the settings have chosen, or null when a picture is. */
export function chosenRef(keys: LiveKeys): string | null {
  switch (keys.kind) {
    case "shader":
      return keys.shader === undefined ? null : `shader:${keys.shader}`;
    case "video":
      return keys.video === undefined ? null : `video:${keys.video}`;
    case "wallpaperengine":
      return keys.workshop === undefined ? null : `we:${keys.workshop}`;
    default:
      return null;
  }
}

/** What choosing `ref` writes to `appearance.wallpaper`; null for a ref that names nothing. */
export function patchFor(ref: string): { kind: "shader"; shader: "aurora" | "drift" | "tide" } | { kind: "video"; video: string } | { kind: "wallpaperengine"; workshop: string } | null {
  const [type, ...rest] = ref.split(":");
  const value = rest.join(":");
  if (type === "shader") {
    const shader = LIVE_SHADERS.find((candidate) => candidate.id === value);
    return shader ? { kind: "shader", shader: shader.id } : null;
  }
  if (type === "video" && value !== "") return { kind: "video", video: value };
  if (type === "we" && /^[0-9]{1,20}$/.test(value)) return { kind: "wallpaperengine", workshop: value };
  return null;
}

/** The sentence under the Wallpaper Engine tiles when something is missing, or null. */
export function engineHint(scan: LiveScan): string | null {
  if (!scan.hasRenderer) return "Wallpaper Engine and video wallpapers need linux-wallpaperengine (scripts/install.sh --with-wallpaperengine).";
  if (scan.discovery.assets === null) return "Install Wallpaper Engine in Steam to use its wallpapers.";
  if (scan.discovery.items.length === 0) return "No Wallpaper Engine wallpapers found. Subscribe to some in Steam's Workshop.";
  return null;
}
