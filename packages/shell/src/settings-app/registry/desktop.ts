/** The rows of Control Center and Desktop & Dock. */

import { DOCK_STYLES } from "../../dock/settings.ts";
import { DESKTOPS, DISPLAY, DOCK, GRID, IMAGE, SCROLL, SLIDERS } from "../../shared/settings/knob-glyphs.ts";
import type { ChoiceOption, RowDef } from "./types.ts";
import { choiceSchema, dockSetting, storedSwitch } from "./values.ts";

const DOCK_STYLE_OPTIONS: readonly ChoiceOption[] = [
  { value: "dock", label: "Dock" },
  { value: "taskbar", label: "Taskbar" },
];
export const DESKTOP_ROWS = [
  {
    id: "control-center/edit",
    glyph: GRID,
    title: "Edit the layout",
    name: "Edit Control Center",
    detail: "Move, resize and add controls: the same as right-clicking the panel.",
    keywords: ["edit controls", "tiles", "customize", "add controls", "remove controls"],
    kind: "action",
  },
  {
    id: "control-center/sliders",
    glyph: SLIDERS,
    title: "Sliders",
    name: "Control Center sliders",
    detail: "The volume and brightness sliders: standing side by side, or lying across the panel.",
    keywords: ["tall", "flat", "volume slider", "brightness slider"],
    kind: "choice",
    options: [
      { value: "tall", label: "Tall pair" },
      { value: "flat", label: "Flat" },
    ],
  },
  {
    id: "control-center/applets",
    title: "Applets' controls",
    detail: "Controls that programs in the menu bar offer, drawn by Dashi.",
    keywords: ["applet controls", "applets"],
    kind: "value",
  },

  {
    id: "desktop-dock/style",
    glyph: IMAGE,
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
    glyph: SCROLL,
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
    glyph: DOCK,
    title: "Show the Dock",
    detail: "With it off, there is no Dock, and windows reach the bottom edge.",
    keywords: ["dock", "taskbar"],
    kind: "switch",
    value: dockSetting("visible", { type: "boolean" }),
  },
  {
    id: "desktop-dock/go-to-app-desktop",
    glyph: DESKTOPS,
    title: "Go to an app's desktop",
    detail: "Opening an app goes to the desktop its window is on, instead of bringing the window to you.",
    keywords: ["spaces", "desktops", "switch desktop"],
    kind: "switch",
    value: storedSwitch("spaces", "switchOnActivate", true),
  },
  {
    id: "desktop-dock/full-screen-desktop",
    glyph: DISPLAY,
    title: "Give full-screen apps their own desktop",
    detail: "A game or video in full screen gets a desktop next to yours, and comes back when it leaves.",
    keywords: ["full screen", "fullscreen", "full-screen apps", "games"],
    kind: "switch",
    value: storedSwitch("spaces", "fullscreenDesktop", true),
  },
] as const satisfies readonly RowDef[];
