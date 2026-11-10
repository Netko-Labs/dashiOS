/** The rows of Appearance and Wallpaper. */

import { DEFAULT_TEXT_SIZE, TEXT_SIZES } from "@dashi/ui";
import { DEFAULT_POINTER_SIZE, POINTER_SIZES } from "../../pointer.ts";
import { CORNER_NAMES, type CornerName, DEFAULT_CORNERS } from "../../shared/appearance/index.ts";
import { BATTERY, CONTRAST, CORNER, DISPLAY, IMAGE, MOON, MOTION, POINTER, RING, TEXT, VIDEO } from "../../shared/settings/index.ts";
import { DEFAULT_WALLPAPER_MODE } from "../../wallpaper/catalog.ts";
import { DEFAULT_FRAME_RATE, FRAME_RATES } from "../../wallpaper/live/choice.ts";
import type { ChoiceOption, RowDef } from "./types.ts";
import { flag, storedChoice, storedSwitch } from "./values.ts";

const CORNER_LABELS: Record<CornerName, string> = { none: "None", small: "Small", medium: "Medium", large: "Large" };
export const CORNER_OPTIONS: readonly ChoiceOption[] = CORNER_NAMES.map((value) => ({ value, label: CORNER_LABELS[value] }));
const POINTER_LABELS: Record<(typeof POINTER_SIZES)[number], string> = { 24: "Standard", 32: "Large", 40: "Larger", 48: "Largest" };
const POINTER_OPTIONS: readonly ChoiceOption[] = POINTER_SIZES.map((value) => ({ value, label: POINTER_LABELS[value] }));
/** In TEXT_SIZES' order. */
const TEXT_LABELS = ["Default", "Large", "Larger", "Largest"] as const;
const TEXT_OPTIONS: readonly ChoiceOption[] = TEXT_SIZES.map((value, index) => ({ value, label: TEXT_LABELS[index] ?? `${value}×` }));
const WALLPAPER_MODE_OPTIONS: readonly ChoiceOption[] = [
  { value: "fill", label: "Fill" },
  { value: "fit", label: "Fit" },
  { value: "center", label: "Center" },
];
const FRAME_RATE_OPTIONS: readonly ChoiceOption[] = FRAME_RATES.map((rate) => ({ value: rate, label: `${rate} fps` }));
export const APPEARANCE_ROWS = [
  {
    id: "appearance/dark-mode",
    glyph: CONTRAST,
    title: "Dark Mode",
    detail: "The shell and apps repaint dark.",
    keywords: ["dark", "light mode", "theme", "night mode", "auto"],
    kind: "switch",
    value: flag("dark"),
    agent: "dark_mode",
  },
  {
    id: "appearance/automatic",
    glyph: MOON,
    title: "Automatic",
    detail: "Dark from 7 PM to 7 AM.",
    keywords: ["auto", "schedule", "evening", "night", "sunset"],
    kind: "switch",
    value: storedSwitch("appearance", "auto", false),
  },
  {
    id: "appearance/window-corners",
    glyph: CORNER,
    title: "Window corners",
    detail: "How round windows are, app content included.",
    keywords: ["corners", "round", "radius"],
    kind: "choice",
    stack: true,
    options: CORNER_OPTIONS,
    value: storedChoice("appearance", "cornerRadius", DEFAULT_CORNERS, CORNER_OPTIONS),
    agent: "window_corners",
  },
  {
    id: "appearance/highlight-active-window",
    glyph: RING,
    title: "Highlight the active window",
    detail: "A ring around the window you're typing in.",
    keywords: ["active window", "focus ring", "highlight"],
    kind: "switch",
    value: storedSwitch("appearance", "highlightActiveWindow", false),
    agent: "highlight_active_window",
  },
  {
    id: "appearance/pointer-size",
    glyph: POINTER,
    title: "Pointer size",
    detail: "On every screen and at every scale. Apps that draw their own pointer follow when they next open.",
    keywords: ["cursor size", "bigger pointer", "larger pointer", "cursor"],
    kind: "choice",
    stack: true,
    options: POINTER_OPTIONS,
    value: storedChoice("appearance", "pointerSize", DEFAULT_POINTER_SIZE, POINTER_OPTIONS),
    agent: "pointer_size",
  },
  {
    id: "appearance/text-size",
    glyph: TEXT,
    title: "Text size",
    detail: "The launcher grows with it, and so do apps that follow GNOME's text size.",
    keywords: ["font size", "bigger text", "larger text", "smaller text"],
    kind: "choice",
    stack: true,
    options: TEXT_OPTIONS,
    value: storedChoice("appearance", "textSize", DEFAULT_TEXT_SIZE, TEXT_OPTIONS),
    agent: "text_size",
  },
  {
    id: "appearance/reduce-motion",
    glyph: MOTION,
    title: "Reduce motion",
    detail: "Windows open, close, minimize, and move without animation.",
    keywords: ["animations", "motion"],
    kind: "switch",
    value: storedSwitch("appearance", "reduceMotion", false),
    agent: "reduce_motion",
  },

  {
    id: "wallpaper/add-photo",
    glyph: IMAGE,
    title: "Add Photo…",
    detail: "A PNG or JPEG from your files; it stays where it is.",
    keywords: ["photo", "picture"],
    kind: "action",
  },
  { id: "wallpaper/photo-path", glyph: IMAGE, title: "Path of a photo", detail: "Press Return to use it.", kind: "value", stack: true },
  {
    id: "wallpaper/picture",
    glyph: DISPLAY,
    title: "Picture",
    name: "Wallpaper fit",
    detail: "Fill covers the screen and crops what does not fit; Fit shows all of the picture; Center leaves it at its size.",
    keywords: ["fill", "fit", "center"],
    kind: "choice",
    stack: true,
    options: WALLPAPER_MODE_OPTIONS,
    value: storedChoice("wallpaper", "mode", DEFAULT_WALLPAPER_MODE, WALLPAPER_MODE_OPTIONS),
  },
  {
    id: "wallpaper/add-video",
    glyph: VIDEO,
    title: "Add Video…",
    detail: "An MP4, WebM, MKV, or MOV from your files; it plays muted, in a loop, and stays where it is.",
    keywords: ["video wallpaper", "live wallpaper"],
    kind: "action",
  },
  { id: "wallpaper/video-path", glyph: VIDEO, title: "Path of a video", detail: "Press Return to use it.", kind: "value", stack: true },
  {
    id: "wallpaper/pause-on-battery",
    glyph: BATTERY,
    title: "Pause on battery",
    name: "Pause live wallpaper on battery",
    detail: "Live wallpapers also stop while a window covers the screen, and while the screen is locked or off.",
    kind: "switch",
    value: storedSwitch("wallpaper", "pauseOnBattery", true),
  },
  {
    id: "wallpaper/frame-rate",
    glyph: MOTION,
    title: "Frame rate",
    name: "Live wallpaper frame rate",
    detail: "Higher is smoother and uses more power.",
    keywords: ["fps"],
    kind: "choice",
    stack: true,
    options: FRAME_RATE_OPTIONS,
    value: storedChoice("wallpaper", "fps", DEFAULT_FRAME_RATE, FRAME_RATE_OPTIONS),
  },
] as const satisfies readonly RowDef[];
