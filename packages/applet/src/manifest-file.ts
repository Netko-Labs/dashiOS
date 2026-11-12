/** An applet's applet.json on disk: where it is, and the control icons beside it (define.ts). */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AppletsClient } from "./client.ts";
import { type Manifest, readManifest } from "./manifest.ts";

/** applet.json beside the running file or above it (`DASHI_APPLET_MANIFEST` names it outright). */
export function findManifest(env: Record<string, string | undefined> = process.env, from: string = dirname(Bun.main)): Manifest | null {
  const path = manifestPath(env, from);
  if (!path) return null;
  const manifest = readManifest(readFileSync(path, "utf8"));
  if ("error" in manifest) {
    console.error(`dashi applets: ${path}: ${manifest.error}`);
    return null;
  }
  return manifest;
}

/** Where applet.json is (beside the running file or above it, or `DASHI_APPLET_MANIFEST`); null when there is none. */
export function manifestPath(env: Record<string, string | undefined> = process.env, from: string = dirname(Bun.main)): string | null {
  const named = env.DASHI_APPLET_MANIFEST;
  let dir = from;
  for (let depth = 0; depth < 6 && !named; depth++) {
    if (existsSync(join(dir, "applet.json"))) break;
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
  const path = named ?? join(dir, "applet.json");
  return existsSync(path) ? path : null;
}

/**
 * Each control's icon (applet.json's `icon`, an .svg under `assets/`) sent
 * as its glyph, so Control Center draws it for an applet in development
 * too (an installed one's the shell reads itself).
 */
export function sendIcons(client: AppletsClient, manifest: Manifest | null, root: string | null): void {
  if (!manifest || !root) return;
  for (const control of manifest.controls) {
    if (!control.icon) continue;
    try {
      const glyph = readFileSync(join(root, control.icon), "utf8").trim();
      if (glyph.length <= 16 * 1024) client.updateControl({ id: control.id, glyph });
    } catch {
      // No icon file: Dashi draws a neutral one.
    }
  }
}
