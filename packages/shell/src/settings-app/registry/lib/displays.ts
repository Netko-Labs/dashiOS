/** The rows of Displays, Night Shift included. */

import { DISPLAY, MENUBAR, NIGHT_SHIFT, POWER, RESOLUTION, ROTATE, SCALE, SUN, WAVE } from "../../../shared/settings/knob-glyphs.ts";
import { DEFAULT_X11_SCALING } from "../../../xwayland-scale.ts";
import { DEFAULT_WARMTH, WARMTH } from "../../lib/night.ts";
import type { ChoiceOption, RowDef } from "../types.ts";
import { flag, storedChoice, storedNumber } from "../values.ts";

const X11_OPTIONS: readonly ChoiceOption[] = [
  { value: "sharp", label: "Sharp" },
  { value: "stretched", label: "Stretched" },
];
export const DISPLAY_ROWS = [
  {
    id: "displays/turned-off",
    glyph: DISPLAY,
    title: "This display is off",
    detail: "It stays plugged in; its windows are on the other screens.",
    kind: "action",
  },
  {
    id: "displays/brightness",
    glyph: SUN,
    title: "Brightness",
    name: "Display brightness",
    keywords: ["backlight", "dim", "screen brightness"],
    kind: "value",
  },
  { id: "displays/resolution", glyph: RESOLUTION, title: "Resolution", keywords: ["screen size", "pixels"], kind: "value", stack: true },
  { id: "displays/refresh-rate", glyph: DISPLAY, title: "Refresh rate", keywords: ["hz", "hertz", "automatic", "battery"], kind: "value", stack: true },
  {
    id: "displays/variable-refresh-rate",
    glyph: WAVE,
    title: "Variable refresh rate",
    detail: "Smoother games and video where the screen allows it.",
    keywords: ["vrr", "freesync", "adaptive sync"],
    kind: "value",
    stack: true,
  },
  { id: "displays/rotation", glyph: ROTATE, title: "Rotation", keywords: ["rotate", "portrait"], kind: "value", stack: true },
  { id: "displays/scale", glyph: SCALE, title: "Scale", name: "Display scale", keywords: ["scaling", "hidpi", "zoom"], kind: "value", stack: true },
  {
    id: "displays/arrange",
    title: "Arrange displays…",
    detail: "Drag the screens to match how they sit on your desk.",
    keywords: ["arrangement", "arrange", "multiple displays", "position"],
    kind: "action",
  },
  {
    id: "displays/mirror",
    title: "Mirror displays",
    detail: "The other displays show the built-in one.",
    keywords: ["mirroring", "screen mirroring", "duplicate", "same picture", "projector", "presentation"],
    kind: "switch",
  },
  {
    id: "displays/main-display",
    glyph: MENUBAR,
    title: "Main display",
    detail: "Put the menu bar and Dock on this screen.",
    keywords: ["primary display"],
    kind: "action",
  },
  { id: "displays/turn-off", glyph: POWER, title: "Turn off this display", detail: "Its windows move to the other screens.", kind: "action" },
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
    glyph: NIGHT_SHIFT,
    title: "Night Shift",
    detail: "Warms the colors of the screens, easier on the eyes in the evening.",
    keywords: ["warm", "blue light", "night"],
    kind: "switch",
    value: flag("night"),
    agent: "night_shift",
  },
  {
    id: "displays/night-shift-schedule",
    partOf: "displays/night-shift",
    title: "Schedule",
    name: "Night Shift schedule",
    keywords: ["night shift schedule"],
    kind: "choice",
    stack: true,
  },
  { id: "displays/night-shift-from", partOf: "displays/night-shift", title: "From", name: "Night Shift starts", kind: "value", stack: true },
  { id: "displays/night-shift-to", partOf: "displays/night-shift", title: "To", name: "Night Shift ends", kind: "value", stack: true },
  {
    id: "displays/night-shift-warmth",
    partOf: "displays/night-shift",
    title: "Warmth",
    name: "Night Shift warmth",
    keywords: ["color temperature", "kelvin"],
    kind: "value",
    value: storedNumber("nightShift", "kelvin", DEFAULT_WARMTH, WARMTH),
  },
] as const satisfies readonly RowDef[];
