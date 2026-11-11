/**
 * The settings file, `~/.config/dashi/settings.json`: where it is, and how a
 * section is read (the object at its path, and only the keys that hold a
 * value of the right kind). System Settings' store (settings-app/store.ts)
 * reads every section this way; the clock reads its two (time/clock.ts).
 * Writing it: write.ts.
 */

import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

export type Raw = Record<string, unknown>;
export type Check = (value: unknown) => boolean;

export const isRaw = (value: unknown): value is Raw => typeof value === "object" && value !== null && !Array.isArray(value);

export const isBoolean: Check = (value) => typeof value === "boolean";
export const numberIn =
  (min: number, max: number, whole = false): Check =>
  (value) =>
    typeof value === "number" && Number.isFinite(value) && value >= min && value <= max && (!whole || Number.isInteger(value));
export const oneOf =
  (...options: string[]): Check =>
  (value) =>
    typeof value === "string" && options.includes(value);

/** Where photos may live (an added wallpaper, an account's picture): absolute, no control characters, a sane length. */
const PHOTO_PATH = /^\/[^\0-\x1f\x7f]{1,4095}$/;

export const isPhotoPath = (value: unknown): value is string => typeof value === "string" && PHOTO_PATH.test(value) && isAbsolute(value);

/** The object at `path` inside `root`, or undefined. */
export function dig(root: Raw, path: readonly string[]): Raw | undefined {
  let at: unknown = root;
  for (const key of path) {
    if (!isRaw(at)) return undefined;
    at = at[key];
  }
  return isRaw(at) ? at : undefined;
}

/** Only the keys of the section at `path` that hold a value of the right kind. */
export function readFields(raw: Raw, path: readonly string[], fields: Record<string, Check>): Raw {
  const found = dig(raw, path);
  const out: Raw = {};
  if (!found) return out;
  for (const [key, check] of Object.entries(fields)) {
    if (Object.hasOwn(found, key) && check(found[key])) out[key] = found[key];
  }
  return out;
}

/** Where the person's settings live: `~/.config/dashi/settings.json`, or under `$XDG_CONFIG_HOME`. */
export function settingsPath(env: Record<string, string | undefined> = process.env, home: string = homedir()): string {
  return join(env.XDG_CONFIG_HOME || join(home, ".config"), "dashi", "settings.json");
}
