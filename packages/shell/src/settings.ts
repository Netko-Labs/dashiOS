/**
 * The user's settings, `~/.config/dashi/settings.json` (or under
 * `$XDG_CONFIG_HOME`). Every key is optional; a missing file, bad JSON, or a
 * value of the wrong kind falls back to the default for that key and is
 * reported, never trusted. The shell applies what dashi-comp can do (input
 * devices, the keyboard layout) over IPC at startup and again when the file
 * changes; the compositor only offers the mechanism (comp/src/devices/).
 *
 *   {
 *     "input": {
 *       "touchpad": { "tap": true, "naturalScroll": true, "accelSpeed": 0.3,
 *                     "disableWhileTyping": true, "clickMethod": "clickfinger",
 *                     "scrollSpeed": 1.5 },
 *       "mouse": { "naturalScroll": false, "accelSpeed": 0, "accelProfile": "flat",
 *                  "scrollSpeed": 1 }
 *     },
 *     "keyboard": { "layout": "de", "variant": "nodeadkeys", "options": "ctrl:nocaps",
 *                   "repeatRate": 30, "repeatDelay": 250 },
 *     "idle": { "blankAfterSeconds": 300 },
 *     "appearance": { "cornerRadius": "medium", "reduceMotion": false,
 *                     "wallpaper": { "path": "midnight", "mode": "fill" } },
 *     "dock": { "style": "dock", "autohide": false, "visible": true },
 *     "spaces": { "count": 3, "switchOnActivate": true }
 *   }
 *
 * `accelSpeed` is -1 to 1; `scrollSpeed` is a factor from 0.25 to 4 on how
 * far a scroll goes (1 is the device's own); `clickMethod` is "buttonAreas" or "clickfinger";
 * `accelProfile` is "flat" or "adaptive"; `layout`, `variant`, and `options`
 * are xkb names ("us,de"); `blankAfterSeconds` 0 never blanks the screens;
 * `dock.style` is "dock" or "taskbar" (dock/settings.ts). `idle.sleepAfterSeconds`
 * puts the computer to sleep after that long away (0, the default, never);
 * `menuBar.batteryPercent` (default false) and `menuBar.sound` (default true)
 * are what the status area shows. `spaces.count` is
 * how many Spaces there are (1 to 16; the shell keeps it as they come and go),
 * `spaces.switchOnActivate` whether activating an app's window on another
 * Space switches there (true) or brings the window here (spaces/).
 * `cornerRadius` is "none", "small", "medium" (the default), or "large", how
 * round every window is (corners.ts). `reduceMotion` turns the compositor's
 * window animations off. `wallpaper.path` is a bundled wallpaper's id or an
 * absolute path to a PNG or JPEG (none is the built-in gradient);
 * `wallpaper.mode` is "fill" (the default), "fit", or "center"
 * (wallpaper/catalog.ts). `wallpaper.kind` ("picture", "shader", "video", or
 * "wallpaperengine") chooses a live wallpaper, with `shader`, `video`,
 * `workshop`, `fps` (15, 30, 60), and `pauseOnBattery` (wallpaper/live/choice.ts).
 * `clock` (`hour24`, `showDate`) and `region` (`formats`, `firstWeekday`) are the person's
 * date and time habits (clock.ts, region/); the shell reads them through
 * settings-app/store.ts, which holds their keys.
 * Keys left out keep the compositor's own (DASHI_XKB_LAYOUT and the like),
 * except a missing touchpad or mouse setting, which is the device's default.
 */

import { existsSync, mkdirSync, readFileSync, watch } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { CORNER_NAMES, type CornerName, DEFAULT_CORNERS } from "./corners.ts";
import { SCROLL_SPEED_MAX, SCROLL_SPEED_MIN } from "./scroll-speed.ts";
import { DOCK_DEFAULTS, DOCK_KEYS, type DockSettings, DOCK_STYLES, resolveDock } from "./dock/settings.ts";
import { DEFAULT_WALLPAPER_MODE, isWallpaperRef, WALLPAPER_MODES, type WallpaperChoice } from "./wallpaper/catalog.ts";
import { FRAME_RATES, isVideoPath, isWorkshopId, LIVE_SHADERS, WALLPAPER_KINDS } from "./wallpaper/live/choice.ts";

export interface TouchpadSettings {
  tap?: boolean;
  naturalScroll?: boolean;
  accelSpeed?: number;
  disableWhileTyping?: boolean;
  clickMethod?: "buttonAreas" | "clickfinger";
  /** A factor on how far a scroll goes, 0.25 to 4 (scroll-speed.ts); 1 with none. */
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

export interface Settings {
  input: { touchpad: TouchpadSettings; mouse: MouseSettings };
  keyboard: KeyboardSettings;
  idle: { blankAfterSeconds: number; sleepAfterSeconds: number };
  /** The status area (settings-app/store.ts `MenuBarSettings`); every key has a value. */
  menuBar: { batteryPercent: boolean; sound: boolean };
  appearance: { cornerRadius: CornerName; reduceMotion: boolean; wallpaper: WallpaperChoice };
  /** The Dock (dock/settings.ts); every key has a value. */
  dock: DockSettings;
  /** Spaces (spaces/): no count leaves them as they are. */
  spaces: { count?: number; switchOnActivate: boolean };
}

export interface Loaded {
  settings: Settings;
  /** What was wrong, for the log; the settings already ignore it. */
  problems: string[];
}

export const DEFAULT_BLANK_AFTER = 300;
/** A week, the compositor's limit for an idle threshold. */
const MAX_BLANK_AFTER = 7 * 24 * 3600;

export function defaults(): Settings {
  return {
    input: { touchpad: {}, mouse: {} },
    keyboard: {},
    idle: { blankAfterSeconds: DEFAULT_BLANK_AFTER, sleepAfterSeconds: 0 },
    menuBar: { batteryPercent: false, sound: true },
    appearance: { cornerRadius: DEFAULT_CORNERS, reduceMotion: false, wallpaper: { mode: DEFAULT_WALLPAPER_MODE } },
    dock: { ...DOCK_DEFAULTS },
    spaces: { switchOnActivate: true },
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Reads one section's keys, reporting what it can't use. */
class Section {
  constructor(
    private readonly name: string,
    private readonly value: unknown,
    private readonly problems: string[],
  ) {
    if (value !== undefined && !isRecord(value)) {
      problems.push(`${name} must be an object`);
      this.value = undefined;
    }
  }

  get(key: string): unknown {
    return isRecord(this.value) ? this.value[key] : undefined;
  }

  private bad(key: string, wanted: string): undefined {
    this.problems.push(`${this.name}.${key} must be ${wanted}`);
    return undefined;
  }

  /** Report keys that mean nothing here. */
  only(known: string[]): this {
    if (isRecord(this.value)) {
      for (const key of Object.keys(this.value)) if (!known.includes(key)) this.problems.push(`unknown setting ${this.name}.${key}`);
    }
    return this;
  }

  boolean(key: string): boolean | undefined {
    const value = this.get(key);
    if (value === undefined) return undefined;
    return typeof value === "boolean" ? value : this.bad(key, "true or false");
  }

  number(key: string, min: number, max: number, whole = false): number | undefined {
    const value = this.get(key);
    if (value === undefined) return undefined;
    const fits = typeof value === "number" && Number.isFinite(value) && value >= min && value <= max && (!whole || Number.isInteger(value));
    return fits ? value : this.bad(key, `${whole ? "a whole number" : "a number"} from ${min} to ${max}`);
  }

  choice<T extends string>(key: string, options: readonly T[]): T | undefined {
    const value = this.get(key);
    if (value === undefined) return undefined;
    return options.find((option) => option === value) ?? this.bad(key, `one of ${options.join(", ")}`);
  }

  /** One of these numbers. */
  numberChoice<T extends number>(key: string, options: readonly T[]): T | undefined {
    const value = this.get(key);
    if (value === undefined) return undefined;
    return options.find((option) => option === value) ?? this.bad(key, `one of ${options.join(", ")}`);
  }

  /** A wallpaper id or an absolute photo path (wallpaper/catalog.ts). */
  ref(key: string): string | undefined {
    const value = this.get(key);
    if (value === undefined) return undefined;
    return isWallpaperRef(value) ? value : this.bad(key, "a wallpaper name or an absolute path");
  }

  /** A string that passes `check`, which says in `wanted` what it takes. */
  text(key: string, check: (value: unknown) => boolean, wanted: string): string | undefined {
    const value = this.get(key);
    if (value === undefined) return undefined;
    return typeof value === "string" && check(value) ? value : this.bad(key, wanted);
  }

  /** An xkb name list: what the compositor's own check accepts. */
  xkb(key: string): string | undefined {
    const value = this.get(key);
    if (value === undefined) return undefined;
    return typeof value === "string" && /^[A-Za-z0-9_,:+.()-]{0,256}$/.test(value) ? value : this.bad(key, "an xkb name list such as us,de");
  }
}

/** Keep only the keys that have a value. */
function defined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

/** Parse settings from JSON already decoded: strict, defaulting per key. */
export function parseSettings(value: unknown): Loaded {
  const problems: string[] = [];
  const settings = defaults();
  if (!isRecord(value)) {
    if (value !== undefined) problems.push("settings must be a JSON object");
    return { settings, problems };
  }
  // displays, nightShift, and spaces are read by displays.ts, night-shift.ts, and spaces/; clock and region by clock.ts
  // and the Setup Assistant (settings-app/store.ts holds their keys).
  const sections = ["input", "keyboard", "idle", "menuBar", "appearance", "dock", "displays", "nightShift", "clock", "region", "spaces"];
  for (const key of Object.keys(value)) if (!sections.includes(key)) problems.push(`unknown section ${key}`);

  const input = new Section("input", value.input, problems).only(["touchpad", "mouse"]);
  const touchpad = new Section("input.touchpad", input.get("touchpad"), problems).only([
    "tap",
    "naturalScroll",
    "accelSpeed",
    "disableWhileTyping",
    "clickMethod",
    "scrollSpeed",
  ]);
  settings.input.touchpad = defined({
    tap: touchpad.boolean("tap"),
    naturalScroll: touchpad.boolean("naturalScroll"),
    accelSpeed: touchpad.number("accelSpeed", -1, 1),
    disableWhileTyping: touchpad.boolean("disableWhileTyping"),
    clickMethod: touchpad.choice("clickMethod", ["buttonAreas", "clickfinger"] as const),
    scrollSpeed: touchpad.number("scrollSpeed", SCROLL_SPEED_MIN, SCROLL_SPEED_MAX),
  });
  const mouse = new Section("input.mouse", input.get("mouse"), problems).only(["naturalScroll", "accelSpeed", "accelProfile", "scrollSpeed"]);
  settings.input.mouse = defined({
    naturalScroll: mouse.boolean("naturalScroll"),
    accelSpeed: mouse.number("accelSpeed", -1, 1),
    accelProfile: mouse.choice("accelProfile", ["flat", "adaptive"] as const),
    scrollSpeed: mouse.number("scrollSpeed", SCROLL_SPEED_MIN, SCROLL_SPEED_MAX),
  });

  const keyboard = new Section("keyboard", value.keyboard, problems).only(["layout", "variant", "options", "repeatRate", "repeatDelay"]);
  settings.keyboard = defined({
    layout: keyboard.xkb("layout"),
    variant: keyboard.xkb("variant"),
    options: keyboard.xkb("options"),
    repeatRate: keyboard.number("repeatRate", 0, 1000, true),
    repeatDelay: keyboard.number("repeatDelay", 0, 10_000, true),
  });

  const idle = new Section("idle", value.idle, problems).only(["blankAfterSeconds", "sleepAfterSeconds"]);
  settings.idle.blankAfterSeconds = idle.number("blankAfterSeconds", 0, MAX_BLANK_AFTER) ?? DEFAULT_BLANK_AFTER;
  settings.idle.sleepAfterSeconds = idle.number("sleepAfterSeconds", 0, MAX_BLANK_AFTER) ?? 0;
  const menuBar = new Section("menuBar", value.menuBar, problems).only(["batteryPercent", "sound"]);
  settings.menuBar = { batteryPercent: menuBar.boolean("batteryPercent") ?? false, sound: menuBar.boolean("sound") ?? true };

  const dock = new Section("dock", value.dock, problems).only([...DOCK_KEYS]);
  settings.dock = resolveDock({
    style: dock.choice("style", DOCK_STYLES),
    autohide: dock.boolean("autohide"),
    visible: dock.boolean("visible"),
  });
  const spaces = new Section("spaces", value.spaces, problems).only(["count", "switchOnActivate"]);
  settings.spaces = defined({ count: spaces.number("count", 1, 16, true), switchOnActivate: spaces.boolean("switchOnActivate") ?? true });
  const appearance = new Section("appearance", value.appearance, problems).only(["cornerRadius", "reduceMotion", "auto", "wallpaper"]);
  settings.appearance.cornerRadius = appearance.choice("cornerRadius", CORNER_NAMES) ?? DEFAULT_CORNERS;
  settings.appearance.reduceMotion = appearance.boolean("reduceMotion") ?? false;
  const wallpaper = new Section("appearance.wallpaper", appearance.get("wallpaper"), problems).only([
    "path",
    "mode",
    "photos",
    "kind",
    "shader",
    "video",
    "videos",
    "workshop",
    "fps",
    "pauseOnBattery",
  ]);
  // A file from before live wallpapers has none of the live keys, and means a picture (wallpaper/live/choice.ts).
  settings.appearance.wallpaper = defined({
    path: wallpaper.ref("path"),
    mode: wallpaper.choice("mode", WALLPAPER_MODES) ?? DEFAULT_WALLPAPER_MODE,
    kind: wallpaper.choice("kind", WALLPAPER_KINDS),
    shader: wallpaper.choice(
      "shader",
      LIVE_SHADERS.map((shader) => shader.id),
    ),
    video: wallpaper.text("video", isVideoPath, "an absolute path to an MP4 or WebM file"),
    workshop: wallpaper.text("workshop", isWorkshopId, "a Steam Workshop id (digits)"),
    fps: wallpaper.numberChoice("fps", FRAME_RATES),
    pauseOnBattery: wallpaper.boolean("pauseOnBattery"),
  }) as WallpaperChoice;
  return { settings, problems };
}

export function settingsPath(env: Record<string, string | undefined> = process.env, home: string = homedir()): string {
  return join(env.XDG_CONFIG_HOME || join(home, ".config"), "dashi", "settings.json");
}

/** Read the file: missing means defaults, quietly; unreadable or bad JSON, defaults and a problem. */
export function loadSettings(path: string = settingsPath()): Loaded {
  if (!existsSync(path)) return parseSettings(undefined);
  let decoded: unknown;
  try {
    decoded = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    const loaded = parseSettings(undefined);
    loaded.problems.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
    return loaded;
  }
  return parseSettings(decoded);
}

/** The compositor client's request, which is all applying settings needs. */
export interface Requester {
  request(method: string, params?: Record<string, unknown>): Promise<unknown>;
}

const hasKeys = (value: object): boolean => Object.keys(value).length > 0;
const hasInput = (settings: Settings): boolean => hasKeys(settings.input.touchpad) || hasKeys(settings.input.mouse);

/** What the compositor takes for "back to the default" for each keyboard key (devices/keyboard.rs). */
const KEYBOARD_DEFAULTS: Required<KeyboardSettings> = { layout: "", variant: "", options: "", repeatRate: 25, repeatDelay: 200 };

/** The keyboard request: what the settings name, plus the default for each key the previous settings named and these dropped. */
export function keyboardRequest(settings: Settings, previous?: Settings): KeyboardSettings {
  const dropped = Object.entries(KEYBOARD_DEFAULTS).filter(([key]) => key in (previous?.keyboard ?? {}) && !(key in settings.keyboard));
  return { ...Object.fromEntries(dropped), ...settings.keyboard };
}

/**
 * Send what dashi-comp can do. `input` goes when the settings have some, or
 * the ones before did (so removing them puts the devices back to their
 * defaults); `keyboard` goes when it names anything or a key it named is
 * gone (that key goes back to the system default). A refusal is logged and
 * the rest still goes.
 */
export async function applySettings(compositor: Requester, settings: Settings, previous?: Settings): Promise<void> {
  const send = async (method: string, params: Record<string, unknown>) => {
    try {
      await compositor.request(method, params);
    } catch (error) {
      console.error(`dashi-shell: dashi-comp refused ${method}:`, error instanceof Error ? error.message : error);
    }
  };
  if (hasInput(settings) || (previous && hasInput(previous))) await send("input", settings.input);
  const keyboard = keyboardRequest(settings, previous);
  if (hasKeys(keyboard)) await send("keyboard", { ...keyboard });
}

/** Editors save by writing, renaming, or replacing; wait for the dust to settle. */
const SETTLE_MS = 150;

/**
 * Call `onChange` when the file changes. Watches the directory, since the
 * file may be replaced or not exist yet. On a fresh install the directory
 * does not exist either, and watching it would fail: it is created first, so
 * the first write (System Settings') is applied without a restart. If it
 * cannot be created there is nothing to watch and the settings are read at
 * startup only.
 */
export function watchSettings(path: string, onChange: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    mkdirSync(dirname(path), { recursive: true });
    const watcher = watch(dirname(path), (_event, name) => {
      if (name && name !== basename(path)) return;
      clearTimeout(timer);
      timer = setTimeout(onChange, SETTLE_MS);
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

/**
 * Load the settings, apply them, and follow the file. `onSettings` hears the
 * settings now and after each change, for what the shell does itself (idle).
 */
export function startSettings(compositor: Requester, onSettings: (settings: Settings) => void, path: string = settingsPath()): () => void {
  let current: Settings | undefined;
  const reload = () => {
    const { settings, problems } = loadSettings(path);
    for (const problem of problems) console.error(`dashi-shell: settings: ${problem}`);
    const previous = current;
    current = settings;
    void applySettings(compositor, settings, previous);
    onSettings(settings);
  };
  reload();
  return watchSettings(path, reload);
}
