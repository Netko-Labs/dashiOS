/**
 * What System Settings' Live section lists, and what choosing each tile
 * writes: pure functions over what the settings hold, so the pane only draws.
 */

import { basename, extname, join } from "node:path";
import { MAX_VIDEOS, type LiveKeys, type LiveShader, LIVE_SHADERS } from "./choice.ts";
import { WALLPAPER_DIR } from "../catalog.ts";

export interface LiveTile {
  /** Unique across the section: `shader:aurora`, `video:/path`. */
  ref: string;
  title: string;
  /** A picture for the tile; null draws a plain one with the title. */
  image: string | null;
}

export const thumbnailFor = (shader: string): string => join(WALLPAPER_DIR, `live-${shader}.thumb.png`);

export function shaderTiles(): LiveTile[] {
  return LIVE_SHADERS.map((shader) => ({ ref: `shader:${shader.id}`, title: shader.title, image: thumbnailFor(shader.id) }));
}

/** The videos the person added (newest first) that are still there, named by their files. */
export function videoTiles(videos: readonly string[], exists: (path: string) => boolean): LiveTile[] {
  return videos.filter(exists).map((path) => ({ ref: `video:${path}`, title: basename(path, extname(path)), image: null }));
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
    default:
      return null;
  }
}

/** What choosing `ref` writes to `appearance.wallpaper`; null for a ref that names nothing. */
export function patchFor(ref: string): { kind: "shader"; shader: LiveShader } | { kind: "video"; video: string } | null {
  const [type, ...rest] = ref.split(":");
  const value = rest.join(":");
  if (type === "shader") {
    const shader = LIVE_SHADERS.find((candidate) => candidate.id === value);
    return shader ? { kind: "shader", shader: shader.id } : null;
  }
  if (type === "video" && value !== "") return { kind: "video", video: value };
  return null;
}
