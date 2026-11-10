/**
 * Where each section of the settings file lives, what each of its keys may
 * hold, and how a decoded file is read into `SettingsData`. The store
 * (store.ts) uses the same checks to refuse a bad value before it writes it.
 */

import { isAnswererChoice, isHarnessId } from "../agents/ask/answerer.ts";
import { isModelName } from "../agents/ask/local.ts";
import { isVrrMode } from "../display-config/monitors.ts";
import type { DockSettings } from "../dock/settings.ts";
import { isAliasMap, isKeyMap } from "../launcher/person-keys.ts";
import { GRAPHICS_FIELDS, type GraphicsSettings, POWER_FIELDS, type PowerSection } from "../power/modes/settings.ts";
import {
  APPEARANCE,
  checksOf,
  DOCK,
  IDLE,
  INPUT_METHOD,
  KEYBOARD,
  type KeyboardSettings,
  MENU_BAR,
  MOUSE,
  type MouseSettings,
  SPACES,
  TOUCHPAD,
  type TouchpadSettings,
  WALLPAPER,
} from "../settings-schema.ts";
import { isCatalogList } from "../shared/applet-store/catalogs.ts";
import { type Check, dig, isBoolean, isPhotoPath, isRaw, numberIn, type Raw, readFields } from "../shared/settings/file.ts";
import { CLOCK_SECTION, type ClockSettings, REGION_SECTION, type RegionSettings } from "../shared/time/clock.ts";
import type {
  AgentsSettings,
  AppearanceSettings,
  AppletsSettings,
  ClipboardSettings,
  DisplaySettings,
  IdleSettings,
  InputMethodSettings,
  LauncherSettings,
  MenuBarSettings,
  NightShiftSettings,
  ScreenSharingSettings,
  SettingsData,
  SpacesSettings,
  WallpaperSettings,
} from "./types.ts";

/** A program `screenSharing.clients` may name: an absolute path, no NUL. */
export const isProgramPath = (value: unknown): value is string =>
  typeof value === "string" && value.startsWith("/") && !value.includes("\0") && value.length <= 4096;

/** An app id or a program name, as `leftOut` holds them. */
const isAppName = (value: unknown): boolean => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);

/** A week, the compositor's limit for an idle threshold. */
const _MAX_BLANK_AFTER = 7 * 24 * 3600;

/** How many added photos the file keeps. */
export const MAX_PHOTOS = 24;
const _isPhotoList: Check = (value) => Array.isArray(value) && value.length <= MAX_PHOTOS && value.every(isPhotoPath);

/** A time of day the way night-shift.ts reads it: `21:00`, or `9:00`. */
const isClock: Check = (value) => typeof value === "string" && /^([01]?\d|2[0-3]):[0-5]\d$/.test(value);
/** An xkb name list such as `us,de`: what the compositor's own check accepts. */
const _isXkbList: Check = (value) => typeof value === "string" && /^[A-Za-z0-9_,:+.()-]{0,256}$/.test(value);

/** Where each section lives in the file, and what each of its keys may hold. */
export const SECTIONS = {
  touchpad: { path: ["input", "touchpad"], fields: checksOf(TOUCHPAD) },
  mouse: { path: ["input", "mouse"], fields: checksOf(MOUSE) },
  keyboard: { path: ["keyboard"], fields: checksOf(KEYBOARD) },
  idle: { path: ["idle"], fields: checksOf(IDLE) },
  menuBar: { path: ["menuBar"], fields: checksOf(MENU_BAR) },
  inputMethod: { path: ["inputMethod"], fields: checksOf(INPUT_METHOD) },
  appearance: { path: ["appearance"], fields: checksOf(APPEARANCE) },
  wallpaper: { path: ["appearance", "wallpaper"], fields: checksOf(WALLPAPER) },
  nightShift: { path: ["nightShift"], fields: { from: isClock, to: isClock, kelvin: numberIn(1900, 6500, true) } },
  dock: { path: ["dock"], fields: checksOf(DOCK) },
  clock: CLOCK_SECTION,
  region: REGION_SECTION,
  spaces: { path: ["spaces"], fields: checksOf(SPACES) },
  power: { path: ["power"], fields: POWER_FIELDS },
  graphics: { path: ["graphics"], fields: GRAPHICS_FIELDS },
  launcher: { path: ["launcher"], fields: { aliases: isAliasMap, keys: isKeyMap } },
  agents: {
    path: ["agents"],
    fields: { answerer: isAnswererChoice, localModel: isModelName, gptModel: isModelName, handOff: isHarnessId, skipGrants: isBoolean },
  },
  clipboard: {
    path: ["clipboard"],
    fields: { history: isBoolean, leftOut: (value) => Array.isArray(value) && value.length <= 64 && value.every(isAppName), snippetsInTerminals: isBoolean },
  },
  screenSharing: { path: ["screenSharing"], fields: { clients: (value) => Array.isArray(value) && value.length <= 64 && value.every(isProgramPath) } },
  applets: { path: ["applets"], fields: { catalogs: isCatalogList } },
} as const satisfies Record<string, { path: readonly string[]; fields: Record<string, Check> }>;

export type Sections = Omit<SettingsData, "displays">;
export type SectionName = keyof Sections;
/** A change to a section: a key set to a value, or to `undefined` to go back to the default. */
export type Change<S extends SectionName> = { [K in keyof Sections[S]]?: Sections[S][K] | undefined };

/** The scale `output` accepts. */
export const isScale = numberIn(0.5, 4);
/** Connector names ("eDP-1", "HDMI-A-1"); anything odder is not written as a key. */
export const isOutputName = (name: string): boolean => /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/.test(name);

/** The object at `path`, made (replacing anything that is not an object) when it is not there. */
export function ensure(root: Raw, path: readonly string[]): Raw {
  let at = root;
  for (const key of path) {
    const next = at[key];
    if (isRaw(next)) {
      at = next;
    } else {
      const made: Raw = {};
      at[key] = made;
      at = made;
    }
  }
  return at;
}

/** Remove `path`'s object if it ended up empty, and then its emptied parents. */
export function prune(root: Raw, path: readonly string[]): void {
  for (let depth = path.length; depth > 0; depth--) {
    const parent = dig(root, path.slice(0, depth - 1));
    if (!parent) return;
    const key = path[depth - 1] as string;
    const child = parent[key];
    if (isRaw(child) && Object.keys(child).length === 0) delete parent[key];
    else return;
  }
}

/** Only the keys of a section that hold a value of the right kind. */
function readSection(raw: Raw, name: SectionName): Raw {
  return readFields(raw, SECTIONS[name].path, SECTIONS[name].fields);
}

/** Everything Settings reads from a decoded file. Never throws. */
export function readSettings(raw: unknown): SettingsData {
  const root: Raw = isRaw(raw) ? raw : {};
  const displays: Record<string, DisplaySettings> = {};
  const saved = dig(root, ["displays"]) ?? {};
  for (const [name, entry] of Object.entries(saved)) {
    if (!isOutputName(name) || !isRaw(entry)) continue;
    const display: DisplaySettings = {
      ...(typeof entry.scale === "number" && isScale(entry.scale) ? { scale: entry.scale } : {}),
      ...(isVrrMode(entry.vrr) ? { vrr: entry.vrr } : {}),
      ...(entry.refresh === "fixed" ? { refresh: "fixed" as const } : {}),
    };
    if (Object.keys(display).length > 0) displays[name] = display;
  }
  return {
    touchpad: readSection(root, "touchpad") as TouchpadSettings,
    mouse: readSection(root, "mouse") as MouseSettings,
    keyboard: readSection(root, "keyboard") as KeyboardSettings,
    idle: readSection(root, "idle") as IdleSettings,
    menuBar: readSection(root, "menuBar") as MenuBarSettings,
    inputMethod: readSection(root, "inputMethod") as InputMethodSettings,
    appearance: readSection(root, "appearance") as AppearanceSettings,
    wallpaper: readSection(root, "wallpaper") as WallpaperSettings,
    nightShift: readSection(root, "nightShift") as NightShiftSettings,
    clock: readSection(root, "clock") as ClockSettings,
    region: readSection(root, "region") as RegionSettings,
    dock: readSection(root, "dock") as Partial<DockSettings>,
    displays,
    spaces: readSection(root, "spaces") as SpacesSettings,
    power: readSection(root, "power") as PowerSection,
    graphics: readSection(root, "graphics") as GraphicsSettings,
    launcher: readSection(root, "launcher") as LauncherSettings,
    agents: readSection(root, "agents") as AgentsSettings,
    clipboard: readSection(root, "clipboard") as ClipboardSettings,
    screenSharing: readSection(root, "screenSharing") as ScreenSharingSettings,
    applets: readSection(root, "applets") as AppletsSettings,
  };
}
