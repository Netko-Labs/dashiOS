/**
 * The appearance keys of settings.json a program outside the shell follows
 * (the portal's SettingChanged, apps/portal/lib/look.ts): Reduce Motion and
 * the pointer's size (pointer.ts), read as the shell's own reader reads
 * them (settings/settings.ts `parseSettings`: each key on its own, a bad
 * value left at its default).
 */

import { existsSync, readFileSync } from "node:fs";
import { bool, isRecord, literal } from "@dashi/shape";
import { settingsPath } from "../settings/index.ts";

export const POINTER_SIZES = [24, 32, 40, 48] as const;
export const DEFAULT_POINTER_SIZE = 24;

export const isPointerSize = (value: unknown): value is number => typeof value === "number" && (POINTER_SIZES as readonly number[]).includes(value);

/** `appearance.reduceMotion` and `appearance.pointerSize`'s shapes; settings/settings-schema.ts's APPEARANCE has them. */
export const REDUCE_MOTION = bool();
export const POINTER_SIZE = literal(...POINTER_SIZES);

export interface MotionSettings {
  reduceMotion: boolean;
  pointerSize: number;
}

/** Reduce Motion and the pointer's size from the settings file at `path`; the defaults when it is missing, unreadable or not an object. */
export function readMotionSettings(path: string = settingsPath()): MotionSettings {
  let decoded: unknown;
  try {
    decoded = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : undefined;
  } catch {
    decoded = undefined;
  }
  const appearance = isRecord(decoded) && isRecord(decoded.appearance) ? decoded.appearance : {};
  const reduceMotion = appearance.reduceMotion === undefined ? undefined : REDUCE_MOTION.parse(appearance.reduceMotion);
  const pointerSize = appearance.pointerSize === undefined ? undefined : POINTER_SIZE.parse(appearance.pointerSize);
  return {
    reduceMotion: reduceMotion?.ok ? reduceMotion.value : false,
    pointerSize: pointerSize?.ok ? pointerSize.value : DEFAULT_POINTER_SIZE,
  };
}
