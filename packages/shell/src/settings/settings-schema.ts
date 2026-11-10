/**
 * `settings.json`'s shared sections, once (Hickey F5): what each key may
 * hold, as shapes. The shell's reader (settings.ts) and System Settings'
 * store (settings-app/store.ts) both read with them, so the two can't
 * disagree on a bound; the types are inferred from them. Defaults stay with
 * whoever reads (the shell's in settings.ts `defaults`).
 */

import { accept, bool, type Infer, int, literal, num, reject, type Shape, shape, str } from "@dashi/shape";
import { TEXT_SIZES } from "@dashi/ui";
import { DOCK_STYLES } from "../dock/settings.ts";
import { INPUT_METHODS } from "../input-method.ts";
import { POINTER_SIZES } from "../pointer.ts";
import { SCROLL_SPEED_MAX, SCROLL_SPEED_MIN } from "../scroll-speed.ts";
import { CORNER_NAMES } from "../shared/appearance/index.ts";
import { isPhotoPath } from "../shared/settings/index.ts";
import { parseSpaceNames } from "../spaces/names.ts";
import type { SpaceNames } from "../spaces/types.ts";
import { isWallpaperRef, WALLPAPER_MODES } from "../wallpaper/catalog.ts";
import { FRAME_RATES, isVideoList, isVideoPath, LIVE_SHADERS, WALLPAPER_KINDS } from "../wallpaper/live/choice.ts";
import { X11_SCALINGS } from "../xwayland-scale.ts";

/** A value a type guard accepts; refused saying `wanted`. */
const guarded = <T>(guard: (value: unknown) => value is T, wanted: string, schema: Record<string, unknown> = {}): Shape<T> =>
  shape(
    (value, where) => (guard(value) ? accept(value) : reject(`${where} must be ${wanted}`)),
    () => schema,
  );

/** A week, the compositor's limit for an idle threshold. */
export const MAX_BLANK_AFTER = 7 * 24 * 3600;

/** How many added photos the file keeps. */
export const MAX_PHOTOS = 24;

/** An xkb name list such as `us,de`: what the compositor's own check accepts. */
const xkb = str({ pattern: /^[A-Za-z0-9_,:+.()-]{0,256}$/ });
const speed = num({ min: -1, max: 1 });
const scrollSpeed = num({ min: SCROLL_SPEED_MIN, max: SCROLL_SPEED_MAX });
const seconds = num({ min: 0, max: MAX_BLANK_AFTER });

export const TOUCHPAD = {
  tap: bool(),
  naturalScroll: bool(),
  accelSpeed: speed,
  disableWhileTyping: bool(),
  clickMethod: literal("buttonAreas", "clickfinger"),
  /** A factor on how far a scroll goes (scroll-speed.ts); 1 with none. */
  scrollSpeed,
};

export const MOUSE = { naturalScroll: bool(), accelSpeed: speed, accelProfile: literal("flat", "adaptive"), scrollSpeed };

export const KEYBOARD = {
  layout: xkb,
  variant: xkb,
  options: xkb,
  repeatRate: int({ min: 0, max: 1000 }),
  repeatDelay: int({ min: 0, max: 10_000 }),
};

export const IDLE = { blankAfterSeconds: seconds, sleepAfterSeconds: seconds };

export const MENU_BAR = { batteryPercent: bool(), sound: bool() };

export const INPUT_METHOD = { engine: literal(...INPUT_METHODS) };

export const APPEARANCE = {
  cornerRadius: literal(...CORNER_NAMES),
  reduceMotion: bool(),
  highlightActiveWindow: bool(),
  auto: bool(),
  pointerSize: literal(...POINTER_SIZES),
  textSize: literal(...TEXT_SIZES),
  x11Apps: literal(...X11_SCALINGS),
};

const isPhotoList = (value: unknown): value is string[] => Array.isArray(value) && value.length <= MAX_PHOTOS && value.every(isPhotoPath);

export const WALLPAPER = {
  path: guarded(isWallpaperRef, "a wallpaper name or an absolute path"),
  mode: literal(...WALLPAPER_MODES),
  photos: guarded(isPhotoList, `a list of up to ${MAX_PHOTOS} photos`),
  kind: literal(...WALLPAPER_KINDS),
  shader: literal(...LIVE_SHADERS.map((shader) => shader.id)),
  video: guarded(isVideoPath, "an absolute path to an MP4, WebM, MKV, or MOV file"),
  videos: guarded(isVideoList, "a list of videos"),
  fps: literal(...FRAME_RATES),
  pauseOnBattery: bool(),
};

export const DOCK = { style: literal(...DOCK_STYLES), autohide: bool(), visible: bool() };

/** What each Desktop is called, tidied (spaces/names.ts). */
const spaceNames: Shape<SpaceNames> = shape(
  (value, where) => {
    const names = parseSpaceNames(value);
    return names ? accept(names) : reject(`${where} must be a list of up to 16 names (or null)`);
  },
  () => ({ type: "array", maxItems: 16, items: { type: ["string", "null"] } }),
);

export const SPACES = {
  count: int({ min: 1, max: 16 }),
  names: spaceNames,
  switchOnActivate: bool(),
  fullscreenDesktop: bool(),
};

// biome-ignore lint/suspicious/noExplicitAny: a section holds shapes of any type; each key is inferred from its own.
export type Fields = Record<string, Shape<any>>;

/** A section as read: each key that holds a good value. */
export type SectionOf<F extends Fields> = { [K in keyof F]?: Infer<F[K]> };

export type TouchpadSettings = SectionOf<typeof TOUCHPAD>;
export type MouseSettings = SectionOf<typeof MOUSE>;
export type KeyboardSettings = SectionOf<typeof KEYBOARD>;

/** Whether a value fits each key: the store's checks (settings-app/store.ts). */
export function checksOf<F extends Fields>(fields: F): { [K in keyof F]: (value: unknown) => boolean } {
  const checks: Record<string, (value: unknown) => boolean> = {};
  for (const [key, field] of Object.entries(fields)) checks[key] = (value) => field.parse(value).ok;
  return checks as { [K in keyof F]: (value: unknown) => boolean };
}

/**
 * One section of a decoded file: the keys that hold a good value; each one
 * that doesn't, and each unknown one, said in `problems` (`input.touchpad.tap
 * must be true or false`). `known` are keys read elsewhere, never a problem.
 */
export function readSection<F extends Fields>(name: string, value: unknown, fields: F, problems: string[], known: readonly string[] = []): SectionOf<F> {
  if (value === undefined) return {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    problems.push(`${name} must be an object`);
    return {};
  }
  const read: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    const field = fields[key];
    if (!field) {
      if (!known.includes(key)) problems.push(`unknown setting ${name}.${key}`);
      continue;
    }
    if (entry === undefined) continue;
    const parsed = field.parse(entry, `${name}.${key}`);
    if (parsed.ok) read[key] = parsed.value;
    else problems.push(parsed.error);
  }
  return read as SectionOf<F>;
}
