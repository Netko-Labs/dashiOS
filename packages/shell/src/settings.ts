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
 *                     "highlightActiveWindow": false,
 *                     "pointerSize": 24, "textSize": 1, "x11Apps": "sharp",
 *                     "wallpaper": { "path": "midnight", "mode": "fill" } },
 *     "dock": { "style": "dock", "autohide": false, "visible": true },
 *     "spaces": { "count": 3, "names": ["Work", null, "Games"], "switchOnActivate": true,
 *                 "fullscreenDesktop": true }
 *   }
 *
 * `accelSpeed` is -1 to 1; `scrollSpeed` is a factor from 0.25 to 4 on how
 * far a scroll goes (1 is the device's own); `clickMethod` is "buttonAreas" or "clickfinger";
 * `accelProfile` is "flat" or "adaptive"; `layout`, `variant`, and `options`
 * are xkb names ("us,de"); `blankAfterSeconds` 0 never blanks the screens;
 * `dock.style` is "dock" or "taskbar" (dock/settings.ts). `idle.sleepAfterSeconds`
 * puts the computer to sleep after that long away (0, the default, never);
 * `menuBar.batteryPercent` (default false) and `menuBar.sound` (default true)
 * are what the status area shows. `inputMethod.engine` is "none" (the default) or
 * "fcitx5", the input method the session runs (input-method.ts). `spaces.count` is
 * how many Spaces there are (1 to 16; the shell keeps it as they come and go),
 * `spaces.names` what each Desktop is called, in order (null: after its apps;
 * spaces/names.ts),
 * `spaces.switchOnActivate` whether activating an app's window on another
 * Space switches there (true) or brings the window here (spaces/);
 * `spaces.fullscreenDesktop` (default true) whether a full-screen window gets
 * a Desktop of its own, uncounted and unnamed here (spaces/fullscreen.ts).
 * `cornerRadius` is "none", "small", "medium" (the default), or "large", how
 * round every window is (shared/appearance/corners.ts). `reduceMotion` turns the compositor's
 * window animations off. `highlightActiveWindow` (default false) rings the
 * window with the keyboard in the accent color (appearance/window-style.ts). `pointerSize` is 24 (the default), 32, 40, or 48
 * points (pointer.ts); `textSize` is 1 (the default), 1.15, 1.3, or 1.5, what the
 * shell's type is multiplied by (text-size.ts); `x11Apps` is "sharp" (the default) or "stretched",
 * how X11 apps meet a scaled screen (xwayland-scale.ts). `wallpaper.path` is a bundled wallpaper's id or an
 * absolute path to a PNG or JPEG (none is the built-in gradient);
 * `wallpaper.mode` is "fill" (the default), "fit", or "center"
 * (wallpaper/catalog.ts). `wallpaper.kind` ("picture", "shader", or "video")
 * chooses a live wallpaper, with `shader`, `video`, `fps` (15, 30, 60), and
 * `pauseOnBattery` (wallpaper/live/choice.ts); an older file's
 * "wallpaperengine" reads as a picture.
 * `clock` (`hour24`, `showDate`) and `region` (`formats`, `firstWeekday`) are the person's
 * date and time habits (clock.ts, region/); the shell reads them through
 * settings-app/store.ts, which holds their keys.
 * `power` (`mode` "automatic" or a mode, `chargeLimit`, `fullChargeOnce`, `fullBy`,
 * `fullByDays`, `boost`, `epp`, `batteryMaxKhz`) and `graphics.mode` are the
 * laptop's (power/modes/settings.ts), read through settings-app/store.ts.
 * `launcher` (`aliases`, `keys`: each names a `dashi://` address) is the
 * person's launcher aliases and keys (launcher/person-keys.ts), read the same way.
 * `applets.catalogs` is the applet catalogs the person added in Software,
 * `[{name, url, key}]` (shared/applet-store/catalogs.ts reads it, entry by entry).
 * `agents` (`answerer`: "claude-code", "codex", "opencode", "local", "claude", "gpt", or
 * "none", unset until the person picks; `localModel`; `gptModel`) is who answers the launcher's Ask (agents/ask/answerer.ts), read the same way.
 * Keys left out keep the compositor's own (DASHI_XKB_LAYOUT and the like),
 * except a missing touchpad or mouse setting, which is the device's default.
 */

import { existsSync, mkdirSync, readFileSync, watch } from "node:fs";
import { basename, dirname } from "node:path";
import { DEFAULT_TEXT_SIZE } from "@dashi/ui";
import type { Compositor } from "./compositor.ts";
import { resolveDock } from "./dock/settings.ts";
import { DEFAULT_INPUT_METHOD } from "./input-method.ts";
import { DEFAULT_POINTER_SIZE } from "./pointer.ts";
import { DEFAULT_BLANK_AFTER, defaults, type Loaded, type Settings } from "./settings-defaults.ts";
import {
  APPEARANCE,
  DOCK,
  IDLE,
  INPUT_METHOD,
  KEYBOARD,
  type KeyboardSettings,
  MENU_BAR,
  MOUSE,
  readSection,
  SPACES,
  TOUCHPAD,
  WALLPAPER,
} from "./settings-schema.ts";
import { DEFAULT_CORNERS } from "./shared/appearance/corners.ts";
import { parseCatalogs } from "./shared/applet-store/catalogs.ts";
import { settingsPath } from "./shared/settings/file.ts";
import { DEFAULT_WALLPAPER_MODE, type WallpaperChoice } from "./wallpaper/catalog.ts";
import { RETIRED_KEYS, RETIRED_KINDS } from "./wallpaper/live/choice.ts";
import { DEFAULT_X11_SCALING } from "./xwayland-scale.ts";

export { DEFAULT_BLANK_AFTER, defaults, type Loaded, type Settings } from "./settings-defaults.ts";
export type { KeyboardSettings, MouseSettings, TouchpadSettings } from "./settings-schema.ts";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The wallpaper the person chose: a file from before live wallpapers has none
 * of the live keys, and means a picture (wallpaper/live/choice.ts); a retired
 * kind is a picture, quietly, its still `path` kept.
 */
function wallpaperOf(value: unknown, problems: string[]): WallpaperChoice {
  const retired = isRecord(value) && RETIRED_KINDS.some((kind) => kind === value.kind);
  const fields = retired && isRecord(value) ? { ...value, kind: undefined } : value;
  const { photos: _photos, videos: _videos, ...read } = readSection("appearance.wallpaper", fields, WALLPAPER, problems, RETIRED_KEYS);
  return { ...read, mode: read.mode ?? DEFAULT_WALLPAPER_MODE, ...(retired ? { kind: "picture" as const } : {}) };
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
  // and the Setup Assistant; launcher by the launcher (settings-app/store.ts holds their keys).
  const sections = [
    "input",
    "keyboard",
    "idle",
    "menuBar",
    "inputMethod",
    "appearance",
    "dock",
    "displays",
    "nightShift",
    "clock",
    "region",
    "spaces",
    "launcher",
    "applets",
  ];
  for (const key of Object.keys(value)) if (!sections.includes(key)) problems.push(`unknown section ${key}`);

  readSection("input", value.input, {}, problems, ["touchpad", "mouse"]);
  const inputs = isRecord(value.input) ? value.input : {};
  settings.input.touchpad = readSection("input.touchpad", inputs.touchpad, TOUCHPAD, problems);
  settings.input.mouse = readSection("input.mouse", inputs.mouse, MOUSE, problems);
  settings.keyboard = readSection("keyboard", value.keyboard, KEYBOARD, problems);
  const idle = readSection("idle", value.idle, IDLE, problems);
  settings.idle = { blankAfterSeconds: idle.blankAfterSeconds ?? DEFAULT_BLANK_AFTER, sleepAfterSeconds: idle.sleepAfterSeconds ?? 0 };
  const menuBar = readSection("menuBar", value.menuBar, MENU_BAR, problems);
  settings.menuBar = { batteryPercent: menuBar.batteryPercent ?? false, sound: menuBar.sound ?? true };
  settings.inputMethod = { engine: readSection("inputMethod", value.inputMethod, INPUT_METHOD, problems).engine ?? DEFAULT_INPUT_METHOD };
  settings.dock = resolveDock(readSection("dock", value.dock, DOCK, problems));
  const spaces = readSection("spaces", value.spaces, SPACES, problems);
  settings.spaces = {
    ...(spaces.count !== undefined ? { count: spaces.count } : {}),
    ...(spaces.names ? { names: spaces.names } : {}),
    switchOnActivate: spaces.switchOnActivate ?? true,
    fullscreenDesktop: spaces.fullscreenDesktop ?? true,
  };
  const appearance = readSection("appearance", value.appearance, APPEARANCE, problems, ["wallpaper"]);
  settings.appearance.cornerRadius = appearance.cornerRadius ?? DEFAULT_CORNERS;
  settings.appearance.reduceMotion = appearance.reduceMotion ?? false;
  settings.appearance.highlightActiveWindow = appearance.highlightActiveWindow ?? false;
  settings.appearance.pointerSize = appearance.pointerSize ?? DEFAULT_POINTER_SIZE;
  settings.appearance.textSize = appearance.textSize ?? DEFAULT_TEXT_SIZE;
  settings.appearance.x11Apps = appearance.x11Apps ?? DEFAULT_X11_SCALING;
  settings.appearance.wallpaper = wallpaperOf(isRecord(value.appearance) ? value.appearance.wallpaper : undefined, problems);
  // Software and the kill switch read the catalogs themselves (shared/applet-store/); here only what is wrong with them is said.
  readSection("applets", value.applets, {}, problems, ["catalogs"]);
  problems.push(...parseCatalogs(isRecord(value.applets) ? value.applets.catalogs : undefined).problems);
  return { settings, problems };
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

/** What applying settings asks of the compositor. */
export type Requester = Pick<Compositor, "input" | "keyboard">;

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
  const send = async (method: string, ask: () => Promise<unknown>) => {
    try {
      await ask();
    } catch (error) {
      console.error(`dashi-shell: dashi-comp refused ${method}:`, error instanceof Error ? error.message : error);
    }
  };
  if (hasInput(settings) || (previous && hasInput(previous))) await send("input", () => compositor.input(settings.input));
  const keyboard = keyboardRequest(settings, previous);
  if (hasKeys(keyboard)) await send("keyboard", () => compositor.keyboard(keyboard));
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
