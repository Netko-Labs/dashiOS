/**
 * Turning a choice into a command for linux-wallpaperengine, the one
 * external renderer behind both Wallpaper Engine items and video
 * wallpapers. It draws a background layer-shell surface per screen
 * (`--screen-root <output>`), which dashi-comp stacks above its own wallpaper
 * and below the windows.
 *
 * Why it also plays plain videos: it already is a layer-shell client with
 * mpv inside (hardware decoding, looping, muted with `--silent`), so a
 * video wallpaper is a generated `type: video` project around the file, and
 * Dashi needs one renderer, one install step, and one supervision path. The
 * alternatives, mpvpaper and mpv with a layer-shell wrapper, are not in
 * Fedora's repositories either and would be a second thing to build.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import type { FrameRate } from "./choice.ts";

/** What the renderer needs to run for a screen. */
export interface RendererSpec {
  /** The executable, absolute. */
  bin: string;
  /** A project folder (absolute): a Workshop item's, or a generated video project. */
  project: string;
  /** Wallpaper Engine's assets folder, or an empty stand-in for a video. */
  assets: string;
  fps: FrameRate;
  /** A video fills the screen; a scene keeps the scaling its author set. */
  scaling: "fill" | "default";
}

/** The command line for the screen named `output`. Structured arguments, never a shell string. */
export function rendererArgv(spec: RendererSpec, output: string): string[] {
  return [
    spec.bin,
    // A wallpaper is silent; it must not fight the person's music.
    "--silent",
    "--fps",
    String(spec.fps),
    // Dashi pauses per screen itself (pause.ts); the renderer's own rule pauses on any full-screen window.
    "--no-fullscreen-pause",
    "--assets-dir",
    spec.assets,
    "--scaling",
    spec.scaling,
    "--screen-root",
    output,
    "--bg",
    spec.project,
  ];
}

/** Where linux-wallpaperengine may be: asked for, installed next to Dashi, or on the system. */
export function rendererCandidates(shellDir: string, env: Record<string, string | undefined> = process.env, which: (name: string) => string | null = (name) => Bun.which(name)): string[] {
  // <prefix>/share/dashi/shell -> <prefix>/libexec/dashi/linux-wallpaperengine/ (scripts/install.sh --with-wallpaperengine)
  const installed = join(shellDir, "..", "..", "..", "libexec", "dashi", "linux-wallpaperengine", "linux-wallpaperengine");
  return [env.DASHI_WALLPAPERENGINE, installed, which("linux-wallpaperengine"), "/opt/linux-wallpaperengine/linux-wallpaperengine"].filter(
    (path): path is string => typeof path === "string" && path.startsWith("/"),
  );
}

const isExecutable = (path: string): boolean => {
  try {
    return statSync(path).isFile() && (statSync(path).mode & 0o111) !== 0;
  } catch {
    return false;
  }
};

/** The renderer to run, or null when it is not installed. */
export function findRenderer(shellDir: string, env: Record<string, string | undefined> = process.env, executable: (path: string) => boolean = isExecutable): string | null {
  return rendererCandidates(shellDir, env).find(executable) ?? null;
}

/** The `project.json` of a video project around `file` (a plain name in the same folder). */
export function videoProject(file: string, title: string): string {
  return `${JSON.stringify({ file, title, type: "video", version: 1 }, null, 2)}\n`;
}

/**
 * A project folder for `video` under `base` (a private runtime folder):
 * project.json plus a link to the video, so nothing is copied. The folder
 * is named from the path, so choosing the same video again reuses it.
 */
export function prepareVideoProject(base: string, video: string): string {
  const dir = join(base, `video-${createHash("sha256").update(video).digest("hex").slice(0, 16)}`);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const name = `video${extname(video).toLowerCase()}`;
  const link = join(dir, name);
  rmSync(link, { force: true });
  symlinkSync(video, link);
  writeFileSync(join(dir, "project.json"), videoProject(name, basename(video)), { mode: 0o600 });
  return dir;
}

/** An empty assets folder: a video does not use Wallpaper Engine's, but the renderer insists on one that exists. */
export function prepareStubAssets(base: string): string {
  const dir = join(base, "assets");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}
