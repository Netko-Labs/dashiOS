/** The rows of Appearance, Wallpaper, Displays (Night Shift included), and Desktop & Dock. */

import { DEFAULT_TEXT_SIZE, TEXT_SIZES } from "@dashi/ui";
import { CORNER_NAMES, type CornerName, DEFAULT_CORNERS } from "../../corners.ts";
import { DOCK_STYLES } from "../../dock/settings.ts";
import { DEFAULT_POINTER_SIZE, POINTER_SIZES } from "../../pointer.ts";
import { DEFAULT_WALLPAPER_MODE } from "../../wallpaper/catalog.ts";
import { DEFAULT_FRAME_RATE, FRAME_RATES } from "../../wallpaper/live/choice.ts";
import { DEFAULT_X11_SCALING } from "../../xwayland-scale.ts";
import { DEFAULT_WARMTH, WARMTH } from "../night.ts";
import type { ChoiceOption, RowDef } from "./types.ts";
import { choiceSchema, dockSetting, flag, storedChoice, storedNumber, storedSwitch } from "./values.ts";

const CORNER_LABELS: Record<CornerName, string> = { none: "None", small: "Small", medium: "Medium", large: "Large" };
export const CORNER_OPTIONS: readonly ChoiceOption[] = CORNER_NAMES.map((value) => ({ value, label: CORNER_LABELS[value] }));
const POINTER_LABELS: Record<(typeof POINTER_SIZES)[number], string> = { 24: "Standard", 32: "Large", 40: "Larger", 48: "Largest" };
const POINTER_OPTIONS: readonly ChoiceOption[] = POINTER_SIZES.map((value) => ({ value, label: POINTER_LABELS[value] }));
/** In TEXT_SIZES' order. */
const TEXT_LABELS = ["Default", "Large", "Larger", "Largest"] as const;
const TEXT_OPTIONS: readonly ChoiceOption[] = TEXT_SIZES.map((value, index) => ({ value, label: TEXT_LABELS[index] ?? `${value}×` }));
const DOCK_STYLE_OPTIONS: readonly ChoiceOption[] = [
  { value: "dock", label: "Dock" },
  { value: "taskbar", label: "Taskbar" },
];
const WALLPAPER_MODE_OPTIONS: readonly ChoiceOption[] = [
  { value: "fill", label: "Fill" },
  { value: "fit", label: "Fit" },
  { value: "center", label: "Center" },
];
const FRAME_RATE_OPTIONS: readonly ChoiceOption[] = FRAME_RATES.map((rate) => ({ value: rate, label: `${rate} fps` }));
const X11_OPTIONS: readonly ChoiceOption[] = [
  { value: "sharp", label: "Sharp" },
  { value: "stretched", label: "Stretched" },
];

export const LOOK_ROWS = [
  {
    id: "appearance/dark-mode",
    title: "Dark Mode",
    detail: "The shell and apps repaint dark.",
    keywords: ["dark", "light mode", "theme", "night mode", "auto"],
    kind: "switch",
    value: flag("dark"),
    agent: "dark_mode",
  },
  {
    id: "appearance/accent-color",
    title: "Accent color",
    detail: "Selections, switches, and sliders.",
    keywords: ["accent", "highlight color"],
    kind: "value",
  },
  {
    id: "appearance/window-corners",
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
    title: "Highlight the active window",
    detail: "A ring in the accent color around the window you're typing in.",
    keywords: ["active window", "focus ring", "highlight"],
    kind: "switch",
    value: storedSwitch("appearance", "highlightActiveWindow", false),
    agent: "highlight_active_window",
  },
  {
    id: "appearance/pointer-size",
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
    title: "Reduce motion",
    detail: "Windows open, close, minimize, and move without animation.",
    keywords: ["animations", "motion"],
    kind: "switch",
    value: storedSwitch("appearance", "reduceMotion", false),
    agent: "reduce_motion",
  },

  {
    id: "wallpaper/add-photo",
    title: "Add Photo…",
    detail: "A PNG or JPEG from your files; it stays where it is.",
    keywords: ["photo", "picture"],
    kind: "action",
  },
  { id: "wallpaper/photo-path", title: "Path of a photo", detail: "Press Return to use it.", kind: "value", stack: true },
  {
    id: "wallpaper/picture",
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
    title: "Add Video…",
    detail: "An MP4, WebM, MKV, or MOV from your files; it plays muted, in a loop, and stays where it is.",
    keywords: ["video wallpaper", "live wallpaper"],
    kind: "action",
  },
  { id: "wallpaper/video-path", title: "Path of a video", detail: "Press Return to use it.", kind: "value", stack: true },
  {
    id: "wallpaper/pause-on-battery",
    title: "Pause on battery",
    name: "Pause live wallpaper on battery",
    detail: "Live wallpapers also stop while a window covers the screen, and while the screen is locked or off.",
    kind: "switch",
    value: storedSwitch("wallpaper", "pauseOnBattery", true),
  },
  {
    id: "wallpaper/frame-rate",
    title: "Frame rate",
    name: "Live wallpaper frame rate",
    detail: "Higher is smoother and uses more power.",
    keywords: ["fps"],
    kind: "choice",
    stack: true,
    options: FRAME_RATE_OPTIONS,
    value: storedChoice("wallpaper", "fps", DEFAULT_FRAME_RATE, FRAME_RATE_OPTIONS),
  },

  { id: "displays/turned-off", title: "This display is off", detail: "It stays plugged in; its windows are on the other screens.", kind: "action" },
  { id: "displays/resolution", title: "Resolution", keywords: ["screen size", "pixels"], kind: "value", stack: true },
  { id: "displays/refresh-rate", title: "Refresh rate", keywords: ["hz", "hertz"], kind: "value", stack: true },
  {
    id: "displays/variable-refresh-rate",
    title: "Variable refresh rate",
    detail: "Smoother games and video where the screen allows it.",
    keywords: ["vrr", "freesync", "adaptive sync"],
    kind: "value",
    stack: true,
  },
  { id: "displays/rotation", title: "Rotation", keywords: ["rotate", "portrait"], kind: "value", stack: true },
  { id: "displays/scale", title: "Scale", name: "Display scale", keywords: ["scaling", "hidpi", "zoom"], kind: "value", stack: true },
  { id: "displays/main-display", title: "Main display", detail: "Put the menu bar and Dock on this screen.", keywords: ["primary display"], kind: "action" },
  { id: "displays/turn-off", title: "Turn off this display", detail: "Its windows move to the other screens.", kind: "action" },
  {
    id: "displays/panel-overdrive",
    title: "Panel overdrive",
    detail: "Pixels change faster: less blur in games, a little more power.",
    keywords: ["overdrive", "response time"],
    kind: "switch",
  },
  {
    id: "displays/x11-apps",
    title: "Older apps (X11)",
    name: "Older apps (X11) on a scaled screen",
    detail: "Sharp draws X11 apps at the screen's full detail; Stretched keeps them the right size, a little soft.",
    keywords: ["x11", "xwayland", "steam", "blurry apps"],
    kind: "choice",
    stack: true,
    options: X11_OPTIONS,
    value: storedChoice("appearance", "x11Apps", DEFAULT_X11_SCALING, X11_OPTIONS),
  },
  {
    id: "displays/night-shift",
    title: "Night Shift",
    detail: "Warms the colors of the screens, easier on the eyes in the evening.",
    keywords: ["warm", "blue light", "night"],
    kind: "switch",
    value: flag("night"),
    agent: "night_shift",
  },
  { id: "displays/night-shift-schedule", title: "Schedule", name: "Night Shift schedule", keywords: ["night shift schedule"], kind: "choice", stack: true },
  { id: "displays/night-shift-from", title: "From", name: "Night Shift starts", kind: "value", stack: true },
  { id: "displays/night-shift-to", title: "To", name: "Night Shift ends", kind: "value", stack: true },
  {
    id: "displays/night-shift-warmth",
    title: "Warmth",
    name: "Night Shift warmth",
    keywords: ["color temperature", "kelvin"],
    kind: "value",
    value: storedNumber("nightShift", "kelvin", DEFAULT_WARMTH, WARMTH),
  },

  {
    id: "desktop-dock/style",
    title: "Style",
    name: "Dock style",
    detail: "The Dock floats above the bottom edge; the taskbar fills it, with a button for each window.",
    keywords: ["dock", "taskbar"],
    kind: "choice",
    stack: true,
    options: DOCK_STYLE_OPTIONS,
    value: dockSetting("style", choiceSchema(DOCK_STYLES.map((value) => ({ value, label: value })))),
    agent: "dock_style",
  },
  {
    id: "desktop-dock/autohide",
    title: "Automatically hide and show",
    name: "Automatically hide and show the Dock",
    detail: "The Dock slides away and gives its room back to windows. Push the pointer against the bottom edge to bring it back.",
    keywords: ["dock", "autohide", "hide dock"],
    kind: "switch",
    value: dockSetting("autohide", { type: "boolean" }),
    agent: "dock_autohide",
  },
  {
    id: "desktop-dock/show-dock",
    title: "Show the Dock",
    detail: "Turned off, there is no Dock at all.",
    keywords: ["dock", "taskbar"],
    kind: "switch",
    value: dockSetting("visible", { type: "boolean" }),
  },
  {
    id: "desktop-dock/go-to-app-desktop",
    title: "Go to an app's desktop",
    detail: "Opening an app goes to the desktop its window is on, instead of bringing the window to you.",
    keywords: ["spaces", "desktops", "switch desktop"],
    kind: "switch",
    value: storedSwitch("spaces", "switchOnActivate", true),
  },
  {
    id: "desktop-dock/full-screen-desktop",
    title: "Give full-screen apps their own desktop",
    detail: "A game or video in full screen gets a desktop next to yours, and comes back when it leaves.",
    keywords: ["full screen", "fullscreen", "full-screen apps", "games"],
    kind: "switch",
    value: storedSwitch("spaces", "fullscreenDesktop", true),
  },
] as const satisfies readonly RowDef[];
