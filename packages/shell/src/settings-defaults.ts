/**
 * What settings.ts reads the file into: the `Settings` the shell works from,
 * and the defaults every key falls back to (settings.ts documents the file).
 */

import { DEFAULT_TEXT_SIZE } from "@dashi/ui";
import { DOCK_DEFAULTS, type DockSettings } from "./dock/settings.ts";
import { DEFAULT_INPUT_METHOD, type InputMethodName } from "./input-method.ts";
import { DEFAULT_POINTER_SIZE } from "./pointer.ts";
import type { KeyboardSettings, MouseSettings, TouchpadSettings } from "./settings-schema.ts";
import { type CornerName, DEFAULT_CORNERS } from "./shared/appearance/index.ts";
import type { SpaceNames } from "./spaces/types.ts";
import { DEFAULT_WALLPAPER_MODE, type WallpaperChoice } from "./wallpaper/catalog.ts";
import { DEFAULT_X11_SCALING, type X11Scaling } from "./xwayland-scale.ts";

export interface Settings {
  input: { touchpad: TouchpadSettings; mouse: MouseSettings };
  keyboard: KeyboardSettings;
  idle: { blankAfterSeconds: number; sleepAfterSeconds: number };
  /** The status area (settings-app/store.ts `MenuBarSettings`); every key has a value. */
  menuBar: { batteryPercent: boolean; sound: boolean };
  /** The input method the session runs (input-method.ts). */
  inputMethod: { engine: InputMethodName };
  appearance: {
    cornerRadius: CornerName;
    reduceMotion: boolean;
    highlightActiveWindow: boolean;
    pointerSize: number;
    /** What the shell's type is multiplied by (text-size.ts). */
    textSize: number;
    x11Apps: X11Scaling;
    wallpaper: WallpaperChoice;
  };
  /** The Dock (dock/settings.ts); every key has a value. */
  dock: DockSettings;
  /** Spaces (spaces/): no count leaves them as they are. */
  spaces: { count?: number; names?: SpaceNames; switchOnActivate: boolean; fullscreenDesktop: boolean };
}

export interface Loaded {
  settings: Settings;
  /** What was wrong, for the log; the settings already ignore it. */
  problems: string[];
}

export const DEFAULT_BLANK_AFTER = 300;

export function defaults(): Settings {
  return {
    input: { touchpad: {}, mouse: {} },
    keyboard: {},
    idle: { blankAfterSeconds: DEFAULT_BLANK_AFTER, sleepAfterSeconds: 0 },
    menuBar: { batteryPercent: false, sound: true },
    inputMethod: { engine: DEFAULT_INPUT_METHOD },
    appearance: {
      cornerRadius: DEFAULT_CORNERS,
      reduceMotion: false,
      highlightActiveWindow: false,
      pointerSize: DEFAULT_POINTER_SIZE,
      textSize: DEFAULT_TEXT_SIZE,
      x11Apps: DEFAULT_X11_SCALING,
      wallpaper: { mode: DEFAULT_WALLPAPER_MODE },
    },
    dock: { ...DOCK_DEFAULTS },
    spaces: { switchOnActivate: true, fullscreenDesktop: true },
  };
}
