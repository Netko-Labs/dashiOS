/**
 * Applying the person's region formats beyond the shell. Dates, numbers, and
 * money in other programs follow the `LC_*` variables they start with, so a
 * change does two things: programs the shell starts from now on get the new
 * values in their environment (`launch` copies the shell's), and
 * `~/.config/environment.d/50-dashi-region.conf` carries them to the next
 * login for everything systemd --user starts. The language (`LANG`) is not
 * touched here: that is the system's, set through localed.
 */

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { writeTextAtomic } from "./files.ts";
import { isFormatsLocale } from "./locale.ts";

/** The categories that are formats rather than language or collation. */
export const FORMAT_VARIABLES = ["LC_TIME", "LC_NUMERIC", "LC_MONETARY", "LC_MEASUREMENT", "LC_PAPER"] as const;

const FILE = "50-dashi-region.conf";

/** The environment.d file for `formats`; checked, since its text is read by systemd. */
export function formatsFile(formats: string): string {
  if (!isFormatsLocale(formats)) throw new TypeError(`bad formats locale: ${JSON.stringify(formats)}`);
  return `# Written by System Settings, Language & Region. Delete the "region" setting there to remove it.\n${FORMAT_VARIABLES.map((name) => `${name}=${formats}`).join("\n")}\n`;
}

export interface FormatsDeps {
  env: Record<string, string | undefined>;
  /** `$XDG_CONFIG_HOME`. */
  configHome: string;
}

export const realFormatsDeps = (): FormatsDeps => ({ env: process.env, configHome: process.env.XDG_CONFIG_HOME || join(homedir(), ".config") });

/** The values the variables had before the first change, per environment, so unsetting the formats puts them back. */
const originalsOf = new WeakMap<object, Map<string, string | undefined>>();

/** Make `formats` (or the session's own, when undefined) the formats of everything started from now on. */
export function applyFormats(formats: string | undefined, deps: FormatsDeps = realFormatsDeps()): void {
  if (formats !== undefined && !isFormatsLocale(formats)) return;
  const originals = originalsOf.get(deps.env) ?? new Map<string, string | undefined>();
  originalsOf.set(deps.env, originals);
  for (const name of FORMAT_VARIABLES) {
    if (!originals.has(name)) originals.set(name, deps.env[name]);
    const value = formats ?? originals.get(name);
    if (value === undefined) delete deps.env[name];
    else deps.env[name] = value;
  }
  const dir = join(deps.configHome, "environment.d");
  try {
    if (formats === undefined) {
      rmSync(join(dir, FILE), { force: true });
    } else {
      mkdirSync(dir, { recursive: true });
      writeTextAtomic(join(dir, FILE), formatsFile(formats));
    }
  } catch (error) {
    console.error("dashi-shell: could not write the region formats for the next login:", error instanceof Error ? error.message : error);
  }
}

/** Whether the next-login file exists (for the pane's note). */
export const hasFormatsFile = (deps: FormatsDeps = realFormatsDeps()): boolean => existsSync(join(deps.configHome, "environment.d", FILE));
