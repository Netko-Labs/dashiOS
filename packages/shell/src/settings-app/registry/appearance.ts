/** The rows of Appearance and Wallpaper. */

import { ACCENT_PRESETS, type AccentChoice, DEFAULT_TEXT_SIZE, isAccentChoice, TEXT_SIZES } from "@dashi/ui";
import { CORNER_NAMES, type CornerName, DEFAULT_CORNERS, DEFAULT_POINTER_SIZE, POINTER_SIZES } from "../../shared/appearance/index.ts";
import { BATTERY, CONTRAST, CORNER, DISPLAY, DROP, IMAGE, MOON, MOTION, POINTER, RING, TEXT, VIDEO } from "../../shared/settings/index.ts";
import { DEFAULT_WALLPAPER_MODE } from "../../wallpaper/catalog.ts";
import { DEFAULT_FRAME_RATE, FRAME_RATES } from "../../wallpaper/live/choice.ts";
import type { Binding, ChoiceOption, RowDef } from "./types.ts";
import { choiceSchema, flag, storedChoice, storedSwitch } from "./values.ts";

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
/** The accent's named picks, as agents and links give them: a preset, or the wallpaper's (a colour of their own is the person's, in the pane). */
export const ACCENT_OPTIONS: readonly ChoiceOption[] = [
  ...ACCENT_PRESETS.map((preset) => ({ value: preset.id, label: preset.name })),
  { value: "wallpaper", label: "Wallpaper" },
];

/** `appearance.accent`: Kombu is no setting; a colour reads as its hex. */
const ACCENT: Binding = {
  schema: choiceSchema(ACCENT_OPTIONS),
  key: "appearance.accent",
  fallback: "kombu",
  get: (stores) => {
    const accent: unknown = stores.settings.getSnapshot().data.appearance.accent;
    if (!isAccentChoice(accent)) return "kombu";
    return "preset" in accent ? accent.preset : "custom" in accent ? accent.custom : "wallpaper";
  },
  set: (stores, value) => {
    const accent: AccentChoice | undefined = value === "kombu" ? undefined : value === "wallpaper" ? { wallpaper: true } : { preset: String(value) };
    stores.settings.patch("appearance", { accent });
  },
};
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
    id: "appearance/accent",
    glyph: DROP,
    title: "Accent color",
    detail: "Switches, chosen pills, selection and the active window's ring.",
    keywords: ["accent", "accent color", "color", "colour", "highlight color", "selection color", "theme color"],
    kind: "choice",
    stack: true,
    options: ACCENT_OPTIONS,
    value: ACCENT,
    agent: "accent_colour",
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
    detail: "A ring in the accent color around the window you're typing in.",
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
    id: "appearance/reduce-transparency",
    glyph: CONTRAST,
    title: "Reduce transparency",
    detail: "Glass turns solid: menus, panels, the bar and the Dock keep their colors.",
    keywords: ["transparency", "glass", "blur", "frosted", "solid"],
    kind: "switch",
    value: storedSwitch("appearance", "reduceTransparency", false),
    agent: "reduce_transparency",
  },
  {
    id: "appearance/tint-glass",
    glyph: DROP,
    title: "Tint glass with the wallpaper",
    detail: "The wallpaper's color comes through the glass. Off, glass stays gray.",
    keywords: ["glass", "tint", "wallpaper color", "vibrancy"],
    kind: "switch",
    value: storedSwitch("appearance", "tintGlass", true),
    agent: "tint_glass",
  },
  {
    id: "appearance/glass-for-apps",
    glyph: DISPLAY,
    title: "Glass for other apps",
    detail: "Apps that aren't Dashi's may blur what is behind them where they ask.",
    keywords: ["glass", "blur", "apps", "transparency"],
    kind: "switch",
    value: storedSwitch("appearance", "glassForApps", true),
    agent: "glass_for_apps",
  },

  {
    id: "wallpaper/add-photo",
    glyph: IMAGE,
    title: "Your photos",
    name: "Add a photo as wallpaper",
    detail: "A PNG or JPEG from your files; it stays where it is.",
    keywords: ["photo", "picture"],
    kind: "action",
  },
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
    title: "Your videos",
    name: "Add a video as wallpaper",
    detail: "An MP4, WebM, MKV, or MOV from your files; it plays muted, in a loop, and stays where it is.",
    keywords: ["video wallpaper", "live wallpaper"],
    kind: "action",
  },
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
