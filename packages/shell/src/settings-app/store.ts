/**
 * The writing side of the user's settings file, `~/.config/dashi/settings.json`
 * (or under `$XDG_CONFIG_HOME`). The shell reads the same file and applies
 * what dashi-comp can do (input devices, the keyboard layout, idle blanking);
 * System Settings is what writes it, so a change made there reaches the shell
 * through the file, and a hand edit shows up in Settings.
 *
 *   {
 *     "input": { "touchpad": { "tap": true, … }, "mouse": { … } },
 *     "keyboard": { "layout": "de", "variant": "nodeadkeys", "repeatRate": 30, … },
 *     "idle": { "blankAfterSeconds": 300 },
 *     "appearance": { "cornerRadius": "medium", "reduceMotion": false,
 *                     "wallpaper": { "path": "aurora", "mode": "fill", "photos": ["/home/me/a.jpg"],
 *                                    "kind": "shader", "shader": "aurora", "fps": 30, "pauseOnBattery": true } },
 *     "nightShift": { "from": "21:00", "to": "07:00", "kelvin": 3400 },
 *     "dock": { "style": "taskbar", "autohide": true, "visible": true },
 *     "clock": { "hour24": true, "showDate": false },
 *     "region": { "formats": "de_DE.UTF-8", "firstWeekday": "monday" },
 *     "displays": { "eDP-1": { "scale": 1.5, "refresh": "fixed" } },
 *     "spaces": { "count": 3, "names": ["Work", null], "switchOnActivate": true },
 *     "power": { "mode": "automatic", "chargeLimit": 80 },
 *     "graphics": { "mode": "automatic" },
 *     "clipboard": { "history": true, "leftOut": ["org.keepassxc.KeePassXC"], "snippetsInTerminals": false },
 *     "screenSharing": { "clients": ["/usr/bin/grim"] }
 *   }
 *
 * Writes are read-modify-write on the file as it is now, so keys this module
 * does not know (another section, a setting from a newer shell) survive, and
 * atomic: a temp file in the same directory, flushed, then renamed over the
 * file, so a crash never leaves half a file for the shell's watcher to read.
 * Every value is checked before it is written and again when it is read; a
 * value of the wrong kind is ignored on read (and kept in the file until the
 * person changes that setting).
 */

import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, watch, writeSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { isTextSize, UndoStack } from "@dashi/ui";
import { type AnswererChoice, isAnswererChoice } from "../agents/ask/answerer.ts";
import { isModelName } from "../agents/ask/local.ts";
import { CORNER_NAMES, type CornerName } from "../corners.ts";
import { isVrrMode, type VrrMode } from "../display-config/monitors.ts";
import { isRefreshChoice, type RefreshChoice } from "../display-config/refresh-policy.ts";
import { DOCK_STYLES, type DockSettings } from "../dock/settings.ts";
import { INPUT_METHODS, type InputMethodName } from "../input-method.ts";
import { isAliasMap, isKeyMap } from "../launcher/person-keys.ts";
import { isPointerSize } from "../pointer.ts";
import { GRAPHICS_FIELDS, type GraphicsSettings, POWER_FIELDS, type PowerSection } from "../power/modes/settings.ts";
import { isFormatsLocale } from "../region/locale.ts";
import { SCROLL_SPEED_MAX, SCROLL_SPEED_MIN } from "../scroll-speed.ts";
import { parseSpaceNames, type SpaceNames } from "../spaces/names.ts";
import { isPhotoPath, isWallpaperRef, WALLPAPER_MODES, type WallpaperMode } from "../wallpaper/catalog.ts";
import {
  FRAME_RATES,
  type FrameRate,
  isVideoList,
  isVideoPath,
  LIVE_SHADERS,
  type LiveShader,
  WALLPAPER_KINDS,
  type WallpaperKind,
} from "../wallpaper/live/choice.ts";
import { X11_SCALINGS, type X11Scaling } from "../xwayland-scale.ts";
import { changesPath } from "./changes/file.ts";
import { ChangeLog, type Change as LoggedChange } from "./changes/log.ts";
import { describeChanges } from "./changes/words.ts";

export interface TouchpadSettings {
  tap?: boolean;
  naturalScroll?: boolean;
  accelSpeed?: number;
  disableWhileTyping?: boolean;
  clickMethod?: "buttonAreas" | "clickfinger";
  scrollSpeed?: number;
}

export interface MouseSettings {
  naturalScroll?: boolean;
  accelSpeed?: number;
  accelProfile?: "flat" | "adaptive";
  scrollSpeed?: number;
}

export interface KeyboardSettings {
  layout?: string;
  variant?: string;
  options?: string;
  repeatRate?: number;
  repeatDelay?: number;
}

export interface IdleSettings {
  /** 0 never blanks the screens. */
  blankAfterSeconds?: number;
  /** 0 (or no key) never puts the computer to sleep by itself. */
  sleepAfterSeconds?: number;
}

/** `inputMethod`: the input method the session runs (input-method.ts); none when not set. */
export interface InputMethodSettings {
  engine?: InputMethodName;
}

/** `menuBar`: what the status area shows beyond its defaults. */
export interface MenuBarSettings {
  /** The battery's percentage beside its glyph; off unless set. */
  batteryPercent?: boolean;
  /** The volume glyph; on unless set. */
  sound?: boolean;
}

export interface AppearanceSettings {
  /** How round windows are (corners.ts); medium when not set. */
  cornerRadius?: CornerName;
  /** Window animations off (the compositor's; motion/). */
  reduceMotion?: boolean;
  /** A ring in the accent color around the window with the keyboard (appearance/window-style.ts); off when not set. */
  highlightActiveWindow?: boolean;
  /** Dark Mode follows the time of day: dark in the evening and night (appearance/auto.ts). */
  auto?: boolean;
  /** The pointer's size in points (pointer.ts); 24 when not set. */
  pointerSize?: number;
  /** What the shell's type is multiplied by (text-size.ts); 1 when not set. */
  textSize?: number;
  /** How X11 apps meet a scaled screen (xwayland-scale.ts); sharp when not set. */
  x11Apps?: X11Scaling;
}

/** `appearance.wallpaper`: what the desktop shows behind everything, and the photos the person added. */
export interface WallpaperSettings {
  /** A bundled wallpaper's id or an absolute path; none is the default (wallpaper/catalog.ts). */
  path?: string;
  mode?: WallpaperMode;
  /** Photos added in System Settings, most recent first. */
  photos?: string[];
  /** What runs behind the windows; a picture unless set (wallpaper/live/choice.ts). */
  kind?: WallpaperKind;
  shader?: LiveShader;
  /** The video playing, and the videos added in System Settings, most recent first. */
  video?: string;
  videos?: string[];
  fps?: FrameRate;
  /** Live wallpapers stop on battery unless this is false. */
  pauseOnBattery?: boolean;
}

export interface NightShiftSettings {
  /** "HH:MM" the screens turn warm, and the time they turn back; both or neither make a schedule. */
  from?: string;
  to?: string;
  /** How warm, 1900 (candle) to 6500 (daylight). */
  kelvin?: number;
}

/** `clock`: how the menu bar, the lock screen, and the notification center write the time. */
export interface ClockSettings {
  /** 24-hour time on or off; the region's own habit when not set. */
  hour24?: boolean;
  /** The date in the menu bar; on when not set. */
  showDate?: boolean;
}

export const WEEKDAYS = ["sunday", "monday", "saturday"] as const;
export type FirstWeekday = (typeof WEEKDAYS)[number];

/** `region`: this person's formats, apart from the system language. */
export interface RegionSettings {
  /** The locale dates, times, numbers, and money follow (`de_DE.UTF-8`); the language's own when not set. */
  formats?: string;
  /** The first day of the week; the region's own when not set. */
  firstWeekday?: FirstWeekday;
}

/** Spaces (spaces/): how many there are, kept as they change, and whether activating an app's window on another Space goes there. */
export interface SpacesSettings {
  count?: number;
  /** What each Desktop is called; null after its apps (spaces/names.ts). */
  names?: SpaceNames;
  switchOnActivate?: boolean;
  /** A full-screen window gets a Desktop of its own (spaces/fullscreen.ts); on when unset. */
  fullscreenDesktop?: boolean;
}

/** The person's launcher aliases and keys, each naming a `dashi://` address (launcher/person-keys.ts). */
export interface LauncherSettings {
  /** Alias → address ("ff" → dashi://app/org.mozilla.firefox). */
  aliases?: Readonly<Record<string, string>>;
  /** A rule's `when` → address ("super+alt+n" → dashi://app/dev.dashi.notes/menu/new). */
  keys?: Readonly<Record<string, string>>;
}

/** Who answers the launcher's Ask (agents/ask/answerer.ts); unset until the person picks. */
export interface AgentsSettings {
  answerer?: AnswererChoice;
  /** The local model to ask by name; the first one installed when unset. */
  localModel?: string;
  /** The OpenAI model GPT answers with; the most capable chat model the key lists when unset (agents/ask/gpt-models.ts). */
  gptModel?: string;
}

/** `clipboard`: clipboard history and snippets (clipboard/; Settings › Keyboard). */
export interface ClipboardSettings {
  /** Copies kept for ⌥❖V; on unless set to false. */
  history?: boolean;
  /** The apps whose copies are never kept (app ids or programs); clipboard/privacy.ts DEFAULT_LEFT_OUT unless set. */
  leftOut?: readonly string[];
  /** Snippets expand in terminals too; off unless set. */
  snippetsInTerminals?: boolean;
}

/** `screenSharing`: programs trusted to capture the screen directly, by absolute path (screen-capture.ts; Settings › Privacy & Security). */
export interface ScreenSharingSettings {
  clients?: readonly string[];
}

/** A program `screenSharing.clients` may name: an absolute path, no NUL. */
export const isProgramPath = (value: unknown): value is string =>
  typeof value === "string" && value.startsWith("/") && !value.includes("\0") && value.length <= 4096;

/** An app id or a program name, as `leftOut` holds them. */
const isAppName = (value: unknown): boolean => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);

export interface DisplaySettings {
  /** The scale the person chose; it wins over the one picked from the pixel density. */
  scale?: number;
  /** Variable refresh rate as the person chose it (off when unset). */
  vrr?: VrrMode;
  /**
   * "fixed": the person picked a rate, so Automatic leaves it (display-config/refresh-policy.ts).
   * Unset is Automatic, the default, also for a file from before there was a choice.
   */
  refresh?: RefreshChoice;
}

/** The file as Settings understands it; anything else in the file is kept but not read. */
export interface SettingsData {
  touchpad: TouchpadSettings;
  mouse: MouseSettings;
  keyboard: KeyboardSettings;
  idle: IdleSettings;
  menuBar: MenuBarSettings;
  inputMethod: InputMethodSettings;
  appearance: AppearanceSettings;
  wallpaper: WallpaperSettings;
  nightShift: NightShiftSettings;
  clock: ClockSettings;
  region: RegionSettings;
  /** The keys the file holds; dock/settings.ts `resolveDock` fills in the rest. */
  dock: Partial<DockSettings>;
  displays: Readonly<Record<string, DisplaySettings>>;
  spaces: SpacesSettings;
  /** Power modes, the charge limit, the processor (power/modes/settings.ts). */
  power: PowerSection;
  /** The graphics card's mode (graphics/). */
  graphics: GraphicsSettings;
  /** The launcher's aliases and keys. */
  launcher: LauncherSettings;
  /** Who answers the launcher's Ask. */
  agents: AgentsSettings;
  /** Clipboard history and snippets. */
  clipboard: ClipboardSettings;
  /** Programs that capture the screen without the portal. */
  screenSharing: ScreenSharingSettings;
}

export { DEFAULT_BLANK_AFTER } from "./controls.ts";

/** A week, the compositor's limit for an idle threshold. */
const MAX_BLANK_AFTER = 7 * 24 * 3600;

type Check = (value: unknown) => boolean;

/** How many added photos the file keeps. */
export const MAX_PHOTOS = 24;
const isPhotoList: Check = (value) => Array.isArray(value) && value.length <= MAX_PHOTOS && value.every(isPhotoPath);

const isBoolean: Check = (value) => typeof value === "boolean";
const numberIn =
  (min: number, max: number, whole = false): Check =>
  (value) =>
    typeof value === "number" && Number.isFinite(value) && value >= min && value <= max && (!whole || Number.isInteger(value));
const oneOf =
  (...options: string[]): Check =>
  (value) =>
    typeof value === "string" && options.includes(value);
/** A time of day the way night-shift.ts reads it: `21:00`, or `9:00`. */
const isClock: Check = (value) => typeof value === "string" && /^([01]?\d|2[0-3]):[0-5]\d$/.test(value);
/** An xkb name list such as `us,de`: what the compositor's own check accepts. */
const isXkbList: Check = (value) => typeof value === "string" && /^[A-Za-z0-9_,:+.()-]{0,256}$/.test(value);

/** Where each section lives in the file, and what each of its keys may hold. */
const SECTIONS = {
  touchpad: {
    path: ["input", "touchpad"],
    fields: {
      tap: isBoolean,
      naturalScroll: isBoolean,
      accelSpeed: numberIn(-1, 1),
      disableWhileTyping: isBoolean,
      clickMethod: oneOf("buttonAreas", "clickfinger"),
      scrollSpeed: numberIn(SCROLL_SPEED_MIN, SCROLL_SPEED_MAX),
    },
  },
  mouse: {
    path: ["input", "mouse"],
    fields: {
      naturalScroll: isBoolean,
      accelSpeed: numberIn(-1, 1),
      accelProfile: oneOf("flat", "adaptive"),
      scrollSpeed: numberIn(SCROLL_SPEED_MIN, SCROLL_SPEED_MAX),
    },
  },
  keyboard: {
    path: ["keyboard"],
    fields: { layout: isXkbList, variant: isXkbList, options: isXkbList, repeatRate: numberIn(0, 1000, true), repeatDelay: numberIn(0, 10_000, true) },
  },
  idle: { path: ["idle"], fields: { blankAfterSeconds: numberIn(0, MAX_BLANK_AFTER), sleepAfterSeconds: numberIn(0, MAX_BLANK_AFTER) } },
  menuBar: { path: ["menuBar"], fields: { batteryPercent: isBoolean, sound: isBoolean } },
  inputMethod: { path: ["inputMethod"], fields: { engine: oneOf(...INPUT_METHODS) } },
  appearance: {
    path: ["appearance"],
    fields: {
      cornerRadius: oneOf(...CORNER_NAMES),
      reduceMotion: isBoolean,
      highlightActiveWindow: isBoolean,
      auto: isBoolean,
      pointerSize: isPointerSize,
      textSize: isTextSize,
      x11Apps: oneOf(...X11_SCALINGS),
    },
  },
  wallpaper: {
    path: ["appearance", "wallpaper"],
    fields: {
      path: isWallpaperRef,
      mode: oneOf(...WALLPAPER_MODES),
      photos: isPhotoList,
      kind: oneOf(...WALLPAPER_KINDS),
      shader: oneOf(...LIVE_SHADERS.map((shader) => shader.id)),
      video: isVideoPath,
      videos: isVideoList,
      fps: (value) => FRAME_RATES.some((rate) => rate === value),
      pauseOnBattery: isBoolean,
    },
  },
  nightShift: { path: ["nightShift"], fields: { from: isClock, to: isClock, kelvin: numberIn(1900, 6500, true) } },
  dock: { path: ["dock"], fields: { style: oneOf(...DOCK_STYLES), autohide: isBoolean, visible: isBoolean } },
  clock: { path: ["clock"], fields: { hour24: isBoolean, showDate: isBoolean } },
  region: { path: ["region"], fields: { formats: isFormatsLocale, firstWeekday: oneOf(...WEEKDAYS) } },
  spaces: {
    path: ["spaces"],
    fields: { count: numberIn(1, 16, true), names: (value) => parseSpaceNames(value) !== null, switchOnActivate: isBoolean, fullscreenDesktop: isBoolean },
  },
  power: { path: ["power"], fields: POWER_FIELDS },
  graphics: { path: ["graphics"], fields: GRAPHICS_FIELDS },
  launcher: { path: ["launcher"], fields: { aliases: isAliasMap, keys: isKeyMap } },
  agents: { path: ["agents"], fields: { answerer: isAnswererChoice, localModel: isModelName, gptModel: isModelName } },
  clipboard: {
    path: ["clipboard"],
    fields: { history: isBoolean, leftOut: (value) => Array.isArray(value) && value.length <= 64 && value.every(isAppName), snippetsInTerminals: isBoolean },
  },
  screenSharing: { path: ["screenSharing"], fields: { clients: (value) => Array.isArray(value) && value.length <= 64 && value.every(isProgramPath) } },
} as const satisfies Record<string, { path: readonly string[]; fields: Record<string, Check> }>;

type Sections = Omit<SettingsData, "displays">;
export type SectionName = keyof Sections;
/** A change to a section: a key set to a value, or to `undefined` to go back to the default. */
export type Change<S extends SectionName> = { [K in keyof Sections[S]]?: Sections[S][K] | undefined };

/** The scale `output` accepts. */
const isScale = numberIn(0.5, 4);
/** Connector names ("eDP-1", "HDMI-A-1"); anything odder is not written as a key. */
const isOutputName = (name: string): boolean => /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/.test(name);

type Raw = Record<string, unknown>;
const isRaw = (value: unknown): value is Raw => typeof value === "object" && value !== null && !Array.isArray(value);

export function settingsPath(env: Record<string, string | undefined> = process.env, home: string = homedir()): string {
  return join(env.XDG_CONFIG_HOME || join(home, ".config"), "dashi", "settings.json");
}

/** The object at `path` inside `root`, or undefined. */
function dig(root: Raw, path: readonly string[]): Raw | undefined {
  let at: unknown = root;
  for (const key of path) {
    if (!isRaw(at)) return undefined;
    at = at[key];
  }
  return isRaw(at) ? at : undefined;
}

/** The object at `path`, made (replacing anything that is not an object) when it is not there. */
function ensure(root: Raw, path: readonly string[]): Raw {
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
function prune(root: Raw, path: readonly string[]): void {
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
  const found = dig(raw, SECTIONS[name].path);
  const fields: Record<string, Check> = SECTIONS[name].fields;
  const out: Raw = {};
  if (!found) return out;
  for (const [key, check] of Object.entries(fields)) {
    if (Object.hasOwn(found, key) && check(found[key])) out[key] = found[key];
  }
  return out;
}

/** Everything Settings reads from a decoded file. Never throws. */
export function readSettings(raw: unknown): SettingsData {
  const root: Raw = isRaw(raw) ? raw : {};
  const displays: Record<string, DisplaySettings> = {};
  const saved = dig(root, ["displays"]) ?? {};
  for (const [name, entry] of Object.entries(saved)) {
    if (!isOutputName(name) || !isRaw(entry)) continue;
    const display: DisplaySettings = {
      ...(isScale(entry.scale) ? { scale: entry.scale as number } : {}),
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
  };
}

/** What a view of the store sees: the settings, and why the last save failed (null when it did not). */
export interface SettingsSnapshot {
  data: SettingsData;
  error: string | null;
}

let temporaries = 0;

/**
 * Write `value` as `path` atomically: a temp file next to it, flushed, then
 * renamed over it. A failure leaves the old file as it was.
 */
export function writeJsonAtomic(path: string, value: unknown): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const temp = join(dir, `.${basename(path)}.${process.pid}.${++temporaries}.tmp`);
  try {
    const fd = openSync(temp, "w", 0o600);
    try {
      writeSync(fd, `${JSON.stringify(value, null, 2)}\n`);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temp, path);
  } catch (error) {
    try {
      unlinkSync(temp);
    } catch {
      // Never made, or already gone.
    }
    throw error;
  }
}

export class SettingsStore {
  private snapshot: SettingsSnapshot;
  private readonly listeners = new Set<() => void>();
  /** Edit › Undo in System Settings: each change the log names (changes/). */
  readonly undo = new UndoStack();
  /** Every change people make to a setting: who, what, from what, when (Settings › Recently changed). */
  readonly changes: ChangeLog;

  /**
   * `path` is the settings file; tests point it into a temporary directory.
   * `changesFile` keeps the change log; a store with a file of its own keeps
   * it in memory unless one is given.
   */
  constructor(
    readonly path: string = settingsPath(),
    changesFile: string | null = path === settingsPath() ? changesPath() : null,
  ) {
    this.snapshot = { data: readSettings(this.readFile()), error: null };
    this.changes = new ChangeLog({ undo: this.undo, describe: describeChanges, path: changesFile });
    // Undo writes a section's keys back through `patch`, which checks them again.
    for (const name of Object.keys(SECTIONS) as SectionName[]) {
      this.changes.attach(name, {
        read: (field) => (this.snapshot.data[name] as Record<string, unknown>)[field],
        write: (field, value) => this.patch(name, { [field]: value ?? undefined } as Change<typeof name>),
      });
    }
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): SettingsSnapshot => this.snapshot;

  /** The scale saved for a screen, if the person chose one. */
  displayScale(name: string): number | undefined {
    return this.snapshot.data.displays[name]?.scale;
  }

  /** Read the file again (it may have been edited); listeners hear only a real change. */
  reload(): void {
    const next = readSettings(this.readFile());
    if (JSON.stringify(next) === JSON.stringify(this.snapshot.data)) return;
    this.snapshot = { data: next, error: this.snapshot.error };
    this.notify();
  }

  /**
   * Set keys of a section. A key set to `undefined` is removed, which puts
   * that setting back to its default. Throws on a key or value Settings does
   * not know (a bug in the caller); a failure to save is reported through
   * the snapshot's `error` and the file is left as it was. A change that was
   * saved is told to the change log (`changes`), as one entry, which puts it
   * on `undo` when it is one people make.
   */
  patch<S extends SectionName>(section: S, change: Change<S>): void {
    const spec = SECTIONS[section];
    const fields: Record<string, Check> = spec.fields;
    const entries = Object.entries(change);
    for (const [key, value] of entries) {
      const check = fields[key];
      if (!check) throw new TypeError(`unknown setting ${spec.path.join(".")}.${key}`);
      if (value !== undefined && !check(value)) throw new TypeError(`bad value for ${spec.path.join(".")}.${key}: ${JSON.stringify(value)}`);
    }
    // What each key held, as Settings read it (a value of the wrong kind in the file reads as not set).
    const held = this.snapshot.data[section] as Record<string, unknown>;
    const changes: LoggedChange[] = entries.map(([key, value]) => ({ key: `${section}.${key}`, from: held[key], to: value }));
    this.update((root) => {
      const target = ensure(root, spec.path);
      for (const [key, value] of entries) {
        if (value === undefined) delete target[key];
        else target[key] = value;
      }
      prune(root, spec.path);
    });
    if (this.snapshot.error === null) this.changes.record(changes);
  }

  /** The variable refresh rate saved for a screen, if the person chose one. */
  displayVrr(name: string): VrrMode | undefined {
    return this.snapshot.data.displays[name]?.vrr;
  }

  /** Remember the variable refresh rate chosen for a screen (`undefined` forgets it). */
  setDisplayVrr(name: string, vrr: VrrMode | undefined): void {
    if (!isOutputName(name)) throw new TypeError(`bad screen name: ${JSON.stringify(name)}`);
    if (vrr !== undefined && !isVrrMode(vrr)) throw new TypeError(`bad refresh rate mode: ${JSON.stringify(vrr)}`);
    this.update((root) => {
      const screen = ensure(ensure(root, ["displays"]), [name]);
      if (vrr === undefined) delete screen.vrr;
      else screen.vrr = vrr;
      prune(root, ["displays", name]);
    });
  }

  /** Automatic refresh rate or a rate the person picked, for a screen (Automatic when nothing is saved). */
  displayRefresh(name: string): RefreshChoice {
    return this.snapshot.data.displays[name]?.refresh ?? "automatic";
  }

  /** Remember whether a screen's rate is Automatic; Automatic is the default, so it is written as nothing. */
  setDisplayRefresh(name: string, choice: RefreshChoice): void {
    if (!isOutputName(name)) throw new TypeError(`bad screen name: ${JSON.stringify(name)}`);
    if (!isRefreshChoice(choice)) throw new TypeError(`bad refresh rate choice: ${JSON.stringify(choice)}`);
    this.update((root) => {
      const screen = ensure(ensure(root, ["displays"]), [name]);
      if (choice === "automatic") delete screen.refresh;
      else screen.refresh = choice;
      prune(root, ["displays", name]);
    });
  }

  /** Remember the scale chosen for a screen (`undefined` forgets it). */
  setDisplayScale(name: string, scale: number | undefined): void {
    if (!isOutputName(name)) throw new TypeError(`bad screen name: ${JSON.stringify(name)}`);
    if (scale !== undefined && !isScale(scale)) throw new TypeError(`bad scale: ${JSON.stringify(scale)}`);
    this.update((root) => {
      const screen = ensure(ensure(root, ["displays"]), [name]);
      if (scale === undefined) delete screen.scale;
      else screen.scale = scale;
      prune(root, ["displays", name]);
    });
  }

  /** Follow the file: edits made by hand or by another program show up. Returns a stop function. */
  watch(): () => void {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const watcher = watch(dirname(this.path), (_event, name) => {
        if (name && name !== basename(this.path)) return;
        clearTimeout(timer);
        timer = setTimeout(() => this.reload(), 100);
      });
      watcher.on("error", () => {});
      return () => {
        clearTimeout(timer);
        watcher.close();
      };
    } catch {
      return () => {};
    }
  }

  /** The file decoded; `{}` when it is missing, unreadable, or not a JSON object. */
  private readFile(): Raw {
    if (!existsSync(this.path)) return {};
    try {
      const value: unknown = JSON.parse(readFileSync(this.path, "utf8"));
      if (isRaw(value)) return value;
    } catch {
      // Not JSON, or unreadable: nothing to read.
    }
    return {};
  }

  /** Apply `edit` to the file as it is now and save the result. */
  private update(edit: (root: Raw) => void): void {
    try {
      const root = this.rootForWrite();
      edit(root);
      writeJsonAtomic(this.path, root);
      this.snapshot = { data: readSettings(root), error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`dashi-shell: could not save ${this.path}:`, message);
      this.snapshot = { ...this.snapshot, error: message };
    }
    this.notify();
  }

  /**
   * The object to edit. A file that is not valid JSON (or not an object) is
   * moved to `settings.json.invalid` before it is replaced, so hand-written
   * content is never silently thrown away.
   */
  private rootForWrite(): Raw {
    if (!existsSync(this.path)) return {};
    const text = readFileSync(this.path, "utf8");
    try {
      const value: unknown = JSON.parse(text);
      if (isRaw(value)) return value;
    } catch {
      // Handled below.
    }
    renameSync(this.path, `${this.path}.invalid`);
    console.error(`dashi-shell: ${this.path} was not a JSON object; kept as ${basename(this.path)}.invalid`);
    return {};
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
