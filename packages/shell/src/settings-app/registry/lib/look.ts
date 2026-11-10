/** The rows of Appearance, Wallpaper, Displays (Night Shift included), Control Center, and Desktop & Dock. */

import { APPEARANCE_ROWS } from "../appearance.ts";
import { DESKTOP_ROWS } from "./desktop.ts";
import { DISPLAY_ROWS } from "./displays.ts";

export const LOOK_ROWS = [...APPEARANCE_ROWS, ...DISPLAY_ROWS, ...DESKTOP_ROWS] as const;
