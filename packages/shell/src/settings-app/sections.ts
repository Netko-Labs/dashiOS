/**
 * Where each section of the settings file lives, what each of its keys may
 * hold, and how a decoded file is read into `SettingsData`. The store
 * (store.ts) uses the same checks to refuse a bad value before it writes it.
 */

import { bool, int, list, str } from "@dashi/shape";
import { isAnswererChoice, isHarnessId } from "../agents/ask/answerer.ts";
import { isModelName } from "../agents/ask/local.ts";
import { isVrrMode } from "../display-config/monitors.ts";
import { isAliasMap, isKeyMap } from "../launcher/person-keys.ts";
import { GRAPHICS_FIELDS, POWER_FIELDS } from "../power/modes/settings.ts";
import { APPEARANCE, DOCK, guarded, IDLE, INPUT_METHOD, KEYBOARD, MENU_BAR, MOUSE, SPACES, TOUCHPAD, WALLPAPER } from "../settings/index.ts";
import { isCatalogList } from "../shared/applet-store/catalogs.ts";
import { dig, type Fields, isRaw, type Raw, readFields, type SectionOf } from "../shared/settings/index.ts";
import { CLOCK_SECTION, REGION_SECTION } from "../shared/time/index.ts";
import type { DisplaySettings, SettingsData } from "./types.ts";

/** A program `screenSharing.clients` may name: an absolute path, no NUL. */
export const isProgramPath = (value: unknown): value is string =>
  typeof value === "string" && value.startsWith("/") && !value.includes("\0") && value.length <= 4096;

/** An app id or a program name, as `leftOut` holds them. */
const appName = str({ pattern: /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/ });

/** How many added photos the file keeps. */
export const MAX_PHOTOS = 24;

/** A time of day the way night-shift.ts reads it: `21:00`, or `9:00`. */
const clock = str({ pattern: /^([01]?\d|2[0-3]):[0-5]\d$/ });

/** Where each section lives in the file, and what each of its keys may hold. */
export const SECTIONS = {
  touchpad: { path: ["input", "touchpad"], fields: TOUCHPAD },
  mouse: { path: ["input", "mouse"], fields: MOUSE },
  keyboard: { path: ["keyboard"], fields: KEYBOARD },
  idle: { path: ["idle"], fields: IDLE },
  menuBar: { path: ["menuBar"], fields: MENU_BAR },
  inputMethod: { path: ["inputMethod"], fields: INPUT_METHOD },
  appearance: { path: ["appearance"], fields: APPEARANCE },
  wallpaper: { path: ["appearance", "wallpaper"], fields: WALLPAPER },
  nightShift: { path: ["nightShift"], fields: { from: clock, to: clock, kelvin: int({ min: 1900, max: 6500 }) } },
  dock: { path: ["dock"], fields: DOCK },
  clock: CLOCK_SECTION,
  region: REGION_SECTION,
  spaces: { path: ["spaces"], fields: SPACES },
  power: { path: ["power"], fields: POWER_FIELDS },
  graphics: { path: ["graphics"], fields: GRAPHICS_FIELDS },
  launcher: {
    path: ["launcher"],
    fields: { aliases: guarded(isAliasMap, "aliases, each naming an address"), keys: guarded(isKeyMap, "keys, each naming an address") },
  },
  agents: {
    path: ["agents"],
    fields: {
      answerer: guarded(isAnswererChoice, "an answerer"),
      localModel: guarded(isModelName, "a model's name"),
      gptModel: guarded(isModelName, "a model's name"),
      handOff: guarded(isHarnessId, "a harness"),
      skipGrants: bool(),
    },
  },
  clipboard: { path: ["clipboard"], fields: { history: bool(), leftOut: list(appName, { max: 64 }), snippetsInTerminals: bool() } },
  screenSharing: { path: ["screenSharing"], fields: { clients: list(guarded(isProgramPath, "an absolute path"), { max: 64 }) } },
  applets: { path: ["applets"], fields: { catalogs: guarded(isCatalogList, "a list of catalogs") } },
} as const satisfies Record<string, { path: readonly string[]; fields: Fields }>;

export type Sections = Omit<SettingsData, "displays">;
export type SectionName = keyof Sections;
/** A change to a section: a key set to a value, or to `undefined` to go back to the default. */
export type Change<S extends SectionName> = { [K in keyof Sections[S]]?: Sections[S][K] | undefined };

/** The scale `output` accepts. */
export const isScale = (value: number): boolean => Number.isFinite(value) && value >= 0.5 && value <= 4;
/** Connector names ("eDP-1", "HDMI-A-1"); anything odder is not written as a key. */
export const isOutputName = (name: string): boolean => /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/.test(name);

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
  const section = <F extends Fields>(spec: { path: readonly string[]; fields: F }): SectionOf<F> => readFields(root, spec.path, spec.fields);
  return {
    touchpad: section(SECTIONS.touchpad),
    mouse: section(SECTIONS.mouse),
    keyboard: section(SECTIONS.keyboard),
    idle: section(SECTIONS.idle),
    menuBar: section(SECTIONS.menuBar),
    inputMethod: section(SECTIONS.inputMethod),
    appearance: section(SECTIONS.appearance),
    wallpaper: section(SECTIONS.wallpaper),
    nightShift: section(SECTIONS.nightShift),
    clock: section(SECTIONS.clock),
    region: section(SECTIONS.region),
    dock: section(SECTIONS.dock),
    displays,
    spaces: section(SECTIONS.spaces),
    power: section(SECTIONS.power),
    graphics: section(SECTIONS.graphics),
    launcher: section(SECTIONS.launcher),
    agents: section(SECTIONS.agents),
    clipboard: section(SECTIONS.clipboard),
    screenSharing: section(SECTIONS.screenSharing),
    applets: section(SECTIONS.applets),
  };
}
