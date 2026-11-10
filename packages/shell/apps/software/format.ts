/** Words for times, and the file an installed app's icon is in. */

import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { InstalledApp } from "../../src/shared/software/index.ts";

/** "just now", "5 minutes ago", "2 hours ago", "yesterday". */
export function ago(at: number | null, now: number): string {
  if (at === null) return "never";
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

const SIZES = ["128x128", "256x256", "64x64", "512x512", "48x48"];

/** The folders flatpak exports an installation's icons to. */
export function exportRoots(env: Readonly<Record<string, string | undefined>> = process.env, home: string = homedir()): Record<"user" | "system", string> {
  const data = env.XDG_DATA_HOME?.startsWith("/") ? env.XDG_DATA_HOME : join(home, ".local/share");
  return { user: join(data, "flatpak/exports/share/icons/hicolor"), system: "/var/lib/flatpak/exports/share/icons/hicolor" };
}

/**
 * The PNG icon an installed app exported, the largest reasonable one; null
 * when it has none (the id is already checked, so it can't climb out of the
 * folder). Looked for off the render path, so a row never blocks a frame.
 */
export async function findLocalIcon(
  app: Pick<InstalledApp, "id" | "installation">,
  roots = exportRoots(),
  exists: (path: string) => Promise<boolean> = (path) =>
    access(path).then(
      () => true,
      () => false,
    ),
): Promise<string | null> {
  const root = roots[app.installation];
  for (const size of SIZES) {
    const path = join(root, size, "apps", `${app.id}.png`);
    if (await exists(path)) return path;
  }
  return null;
}
