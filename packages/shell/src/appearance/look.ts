/**
 * What this machine can dress GTK apps with: whether adw-gtk3 is installed
 * (GTK 3 apps then take libadwaita's look), the accent the portal should
 * name, and whether Dashi's UI font is there. Looked up once, at startup, by
 * reading the filesystem and asking fontconfig; `apps.ts` turns the answer
 * into commands and never runs one for something that is missing.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { AppLook } from "./apps.ts";
import { ACCENT, nearestAccent } from "./gtk-colors.ts";

export const ADW_GTK3 = "adw-gtk3";
/** The family the shell and Metal draw with. */
export const INTERFACE_FAMILY = "Inter";

type Env = Readonly<Record<string, string | undefined>>;

/** Where GTK looks for themes by name: the user's own, then the system's (XDG data dirs). */
export function themeDirs(env: Env, home: string): string[] {
  const dataHome = env.XDG_DATA_HOME?.startsWith("/") ? env.XDG_DATA_HOME : join(home, ".local", "share");
  const dataDirs = (env.XDG_DATA_DIRS || "/usr/local/share:/usr/share").split(":").filter((dir) => dir.startsWith("/"));
  return [join(home, ".themes"), ...[dataHome, ...dataDirs].map((dir) => join(dir, "themes"))];
}

/** Whether a GTK 3 theme called `name` is installed. */
export function hasGtk3Theme(name: string, env: Env, home: string, exists: (path: string) => boolean = existsSync): boolean {
  return themeDirs(env, home).some((dir) => exists(join(dir, name, "gtk-3.0", "gtk.css")));
}

/** `fc-match -f %{family} Inter`: fontconfig answers with the closest family, which is Inter only when it is installed. */
export function isInter(family: string | null): boolean {
  return family?.split(",").some((name) => name.trim() === INTERFACE_FAMILY) === true;
}

export interface Probes {
  env: Env;
  home: string;
  exists: (path: string) => boolean;
  /** The family fontconfig picks for a name, or null when fc-match is missing or failed. */
  closestFamily: (name: string) => string | null;
}

export function detectLook({ env, home, exists, closestFamily }: Probes): AppLook {
  return {
    adwGtk3: hasGtk3Theme(ADW_GTK3, env, home, exists) && hasGtk3Theme(`${ADW_GTK3}-dark`, env, home, exists),
    accent: nearestAccent(ACCENT),
    interFont: isInter(closestFamily(INTERFACE_FAMILY)),
  };
}

/** The real machine's probes. */
export function realProbes(env: Env, home: string): Probes {
  return {
    env,
    home,
    exists: existsSync,
    closestFamily(name) {
      try {
        const result = spawnSync("fc-match", ["-f", "%{family}", name], { encoding: "utf8", timeout: 3000 });
        return result.status === 0 ? result.stdout.trim() : null;
      } catch {
        return null;
      }
    },
  };
}
