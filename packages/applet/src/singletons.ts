/**
 * One copy of the packages that hold React state: an applet depends on
 * @dashi/ui by path, and @dashi/ui brings its own @mirinjs/metal and React
 * (in its node_modules). Two copies of @mirinjs/metal means two React
 * contexts, so @dashi/ui's components never hear what the window says (its
 * title bar, its colors) and React itself refuses two copies of its hooks.
 * These always resolve from the applet's own folder: `pack` builds with the
 * plugin; `dev` runs from source, where a plugin doesn't reach imports inside
 * node_modules, so it takes the nested copies out of the applet's own
 * node_modules first (`dedupeInstalled`; `bun install` puts them back).
 */

import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { BunPlugin } from "bun";

/** The packages there must be only one of. */
export const SINGLETONS = /^(react|react-dom|react-reconciler|scheduler|@mirinjs\/metal)(\/.*)?$/;

/** Resolves `SINGLETONS` from `dir` (the applet's folder), wherever they are imported from. */
export function singletons(dir: string): BunPlugin {
  return {
    name: "dashi-applet-singletons",
    setup(build) {
      build.onResolve({ filter: SINGLETONS }, (args) => {
        try {
          return { path: Bun.resolveSync(args.path, dir) };
        } catch {
          // Not installed in the applet: resolve as usual.
          return undefined;
        }
      });
    },
  };
}

/** The singleton package names, as folders under node_modules ("@mirinjs/metal"). */
const SINGLETON_DIRS = ["react", "react-dom", "react-reconciler", "scheduler", "@mirinjs/metal"];

/**
 * Removes copies of the singletons nested in the applet's dependencies
 * (node_modules/<dependency>/node_modules/<singleton>) when the applet has its
 * own at the top: those imports then find the applet's. Returns what went.
 */
export function dedupeInstalled(dir: string): string[] {
  const top = join(dir, "node_modules");
  if (!existsSync(top)) return [];
  const removed: string[] = [];
  const dependencies = readdirSync(top).flatMap((name) =>
    name.startsWith("@") ? readdirSync(join(top, name)).map((inner) => `${name}/${inner}`) : name.startsWith(".") ? [] : [name],
  );
  for (const dependency of dependencies) {
    for (const singleton of SINGLETON_DIRS) {
      const nested = join(top, dependency, "node_modules", singleton);
      if (existsSync(nested) && existsSync(join(top, singleton))) {
        rmSync(nested, { recursive: true, force: true });
        removed.push(`${dependency} → ${singleton}`);
      }
    }
  }
  return removed;
}
