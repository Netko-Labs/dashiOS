/**
 * The settings file, `~/.config/dashi/settings.json`: where it is, and how a
 * section is read (the object at its path, and only the keys that hold a
 * value of the right kind). System Settings' store (settings-app/store.ts)
 * reads every section this way; the clock reads its two (time/clock.ts).
 * Writing it: write.ts.
 */

import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import type { Infer, Shape } from "@dashi/shape";

export type Raw = Record<string, unknown>;

/** What each key of a section may hold, as shapes (`@dashi/shape`). */
// biome-ignore lint/suspicious/noExplicitAny: a section holds shapes of any type; each key is inferred from its own.
export type Fields = Record<string, Shape<any>>;

/** A section as read: each key that holds a good value, typed by its shape. */
export type SectionOf<F extends Fields> = { [K in keyof F]?: Infer<F[K]> };

export const isRaw = (value: unknown): value is Raw => typeof value === "object" && value !== null && !Array.isArray(value);

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

/**
 * Only the keys of the section at `path` that hold a value of the right kind, each as its shape
 * parsed it: a key with a bad value reads as not set, and never loses the rest.
 */
export function readFields<F extends Fields>(raw: Raw, path: readonly string[], fields: F): SectionOf<F> {
  const found = dig(raw, path);
  const out: SectionOf<F> = {};
  if (!found) return out;
  for (const key of Object.keys(fields) as (keyof F & string)[]) {
    if (!Object.hasOwn(found, key)) continue;
    const parsed = (fields[key] as F[typeof key]).parse(found[key]);
    if (parsed.ok) out[key] = parsed.value;
  }
  return out;
}

/** Where the person's settings live: `~/.config/dashi/settings.json`, or under `$XDG_CONFIG_HOME`. */
export function settingsPath(env: Record<string, string | undefined> = process.env, home: string = homedir()): string {
  return join(env.XDG_CONFIG_HOME || join(home, ".config"), "dashi", "settings.json");
}
