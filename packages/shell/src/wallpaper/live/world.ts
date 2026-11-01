/**
 * The real world a live wallpaper plan looks at: Steam's Workshop, the
 * renderer on this machine, and a private folder under the runtime directory
 * for the generated video projects (gone at logout, like everything there).
 */

import { homedir } from "node:os";
import { join } from "node:path";
import type { World } from "./plan.ts";
import { findRenderer, prepareStubAssets, prepareVideoProject } from "./renderer.ts";
import { discoverWorkshop } from "./workshop.ts";

const SHELL_DIR = join(import.meta.dir, "..", "..", "..");

/** `$XDG_RUNTIME_DIR/dashi/wallpaper`, or null with no runtime directory (nothing is generated then). */
function workFolder(env: Record<string, string | undefined>): string | null {
  const runtime = env.XDG_RUNTIME_DIR;
  return runtime && runtime.startsWith("/") ? join(runtime, "dashi", "wallpaper") : null;
}

/** Looked up again each time a choice is applied, so installing Wallpaper Engine or the renderer needs no restart. */
export function realWorld(env: Record<string, string | undefined> = process.env, home: string = homedir()): World {
  const work = workFolder(env);
  let discovered: ReturnType<typeof discoverWorkshop> | null = null;
  const discovery = () => (discovered ??= discoverWorkshop(home, env));
  return {
    get items() {
      return discovery().items;
    },
    get assets() {
      return discovery().assets;
    },
    bin: findRenderer(SHELL_DIR, env),
    videoProject(video) {
      if (work === null) return null;
      try {
        return prepareVideoProject(work, video);
      } catch (error) {
        console.error("dashi-shell: could not prepare the video wallpaper:", error instanceof Error ? error.message : error);
        return null;
      }
    },
    stubAssets() {
      return prepareStubAssets(work ?? "/nonexistent");
    },
  };
}
