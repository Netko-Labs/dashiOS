/**
 * The shell's own Metal hosts: every surface the shell draws (the menu bar,
 * the Dock, the launcher, sheets, banners, the lock screen) is "Dashi" to a
 * screen reader, not the host binary's file name (`MIRIN_METAL_APP_NAME`,
 * mirin's `appName`). Only the shell's hosts get the name: it is never put
 * in the shell's own environment, which apps and terminals inherit.
 */

import { type NativeHostOptions, type NativeHostTransport, spawnNativeHost } from "@mirinjs/metal";
import { METAL_HOST } from "./apps.ts";

/** What Orca says for the shell's surfaces. */
export const SHELL_APP_NAME = "Dashi";

/** The environment that names a host for screen readers; a host from before it ignores it. */
export function appNameEnv(name: string): Record<string, string> {
  return { MIRIN_METAL_APP_NAME: name };
}

/** `options` for one of the shell's hosts: named Dashi, keeping any environment the caller gave. */
export function shellHostOptions(options: NativeHostOptions): NativeHostOptions {
  return { ...options, env: { ...appNameEnv(SHELL_APP_NAME), ...options.env } };
}

/** Spawn one of the shell's hosts (`METAL_HOST` unless `binary` says otherwise). */
export function spawnShellHost(options: NativeHostOptions, binary: string = METAL_HOST): NativeHostTransport {
  return spawnNativeHost(binary, shellHostOptions(options));
}
