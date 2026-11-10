/**
 * Dark Mode in an app's own process. The shell keeps the switch in
 * `$XDG_STATE_HOME/dashi/control-center.json` (src/shared/control-center/flags.ts) and
 * repaints its own surfaces from memory; an app reads that file at start and
 * follows it from then on, so the palette (`useColors`) and every kit control
 * flip with the shell. Outside a Dashi session (no file yet) the desktop's
 * `color-scheme` (gsettings, which the shell also sets) stands in.
 */

import { existsSync, readFileSync, statSync, watch } from "node:fs";
import { basename, dirname } from "node:path";
import { controlFlags, type Flags, type FlagsStore, flagsPath, parseFlags } from "../../src/shared/control-center/index.ts";

/** How often the file is looked at when it (or its folder) can't be watched yet. */
const POLL_MS = 1000;

/** `gsettings get org.gnome.desktop.interface color-scheme` output → dark or not; null when it says nothing usable. */
export function darkFromColorScheme(output: string): boolean | null {
  const value = output.trim().replace(/^'|'$/g, "");
  if (value === "prefer-dark") return true;
  if (value === "default" || value === "prefer-light") return false;
  return null;
}

function colorSchemeDark(): boolean | null {
  const gsettings = Bun.which("gsettings");
  if (!gsettings) return null;
  try {
    const result = Bun.spawnSync([gsettings, "get", "org.gnome.desktop.interface", "color-scheme"], { stdout: "pipe", stderr: "ignore" });
    return result.exitCode === 0 ? darkFromColorScheme(result.stdout.toString()) : null;
  } catch {
    return null;
  }
}

export interface FollowOptions {
  store?: FlagsStore;
  path?: string;
  /** Asked once when the shell's file is missing; null leaves the default (light). */
  fallback?: () => boolean | null;
}

/**
 * Keeps `store` (the process's `controlFlags()`) in step with the shell's
 * file; returns the function that stops following.
 */
export function followDarkMode(options: FollowOptions = {}): () => void {
  const store = options.store ?? controlFlags();
  const path = options.path ?? flagsPath();
  let stamp = "";
  const read = (): void => {
    let text: string;
    let next: string;
    try {
      const stat = statSync(path);
      next = `${stat.mtimeMs}:${stat.size}`;
      if (next === stamp) return;
      text = readFileSync(path, "utf8");
    } catch {
      return;
    }
    stamp = next;
    const flags: Flags = parseFlags(text);
    store.adopt(flags);
  };

  if (existsSync(path)) {
    read();
  } else {
    const dark = (options.fallback ?? colorSchemeDark)();
    if (dark !== null) store.adopt({ ...store.getSnapshot(), dark });
  }

  // The shell rewrites the file in place; watching its folder also sees it
  // appear. Polling covers a folder that does not exist yet and watchers that miss events.
  let watcher: ReturnType<typeof watch> | null = null;
  try {
    watcher = watch(dirname(path), (_event, file) => {
      if (file === null || file === basename(path)) read();
    });
  } catch {
    watcher = null;
  }
  const timer = setInterval(read, POLL_MS);
  return () => {
    clearInterval(timer);
    watcher?.close();
  };
}
