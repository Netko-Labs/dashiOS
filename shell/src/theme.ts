/**
 * The shell's metrics and palettes: macOS proportions, Dashi's colors, in a
 * light and a dark set. These move to session design tokens later (shell plan
 * E6).
 */

import { controlFlags, useFlags } from "./control-center/flags.ts";

export const MENU_BAR_HEIGHT = 28;

export const DOCK = {
  icon: 48,
  gap: 6,
  /** Panel padding around the icons; the bottom leaves room for the dot. */
  paddingX: 8,
  paddingTop: 6,
  paddingBottom: 4,
  dot: 4,
  radius: 18,
  /** Gap between the Dock and the bottom edge. */
  margin: 6,
} as const;

/** The Dock panel's height: icon, the running dot under it, and padding. */
export const DOCK_HEIGHT = DOCK.paddingTop + DOCK.icon + 3 + DOCK.dot + DOCK.paddingBottom;

/** The taskbar style of the Dock (dock/taskbar.tsx): a bar across the screen's bottom edge. */
export const TASKBAR = {
  height: 48,
  /** A window's button: icon, then its title. */
  buttonHeight: 38,
  buttonMaxWidth: 180,
  icon: 24,
  radius: 8,
} as const;

/** Every color the shell paints with; light and dark fill the same names. */
export interface Palette {
  text: string;
  textMuted: string;
  /** Ink for what can't be used right now: a dimmed menu row or button. */
  textDisabled: string;
  menuBar: string;
  /** The hairline along the menu bar's bottom edge, as on the Mac: it is what separates glass from windows. */
  menuBarEdge: string;
  dock: string;
  dockBorder: string;
  hover: string;
  separator: string;
  dot: string;
  /** Glass for overlays that hold text (launcher, shortcut sheet): more tint. */
  launcher: string;
  /** Dropdowns and Control Center: nearly opaque, since nothing blurs what is behind them yet. */
  menu: string;
  /** The on-screen display (volume, brightness): glass with ink segments. */
  osd: string;
  osdOn: string;
  osdOff: string;
  /** A battery at its last few percent. */
  batteryLow: string;
  /** The selected row: the kombu accent. */
  selection: string;
  /** The chosen app in the switcher, and an open menu bar item: a soft wash. */
  switcherSelection: string;
  /** Secondary buttons on sheets. */
  button: string;
  checkbox: string;
  /** Urgent things: the mark on a critical notification. */
  critical: string;
  /** Tiles and cards on Control Center's panel. */
  tile: string;
  /** A card under the pointer. */
  tileHover: string;
  /** A slider's empty track, and an off switch's circle. */
  track: string;
  /** Agents' own color, shiso (docs/agents.html): the pill, the sheet's mark. */
  agent: string;
  agentInk: string;
  agentWash: string;
  /** The menu bar pill while the screen is being shared: critical red, washed; its dot is `critical`. */
  captureWash: string;
}

export const lightColors: Palette = {
  text: "#1d1d1f",
  textMuted: "#1d1d1f99",
  textDisabled: "#1d1d1f55",
  menuBar: "#f5f5f7c7",
  menuBarEdge: "#0000002b",
  dock: "#f5f5f799",
  dockBorder: "#ffffff73",
  hover: "#ffffff59",
  separator: "#1d1d1f26",
  dot: "#1d1d1fcc",
  launcher: "#f5f5f7eb",
  menu: "#f6f6f8f7",
  osd: "#f5f5f7e0",
  osdOn: "#1d1d1fd9",
  osdOff: "#1d1d1f26",
  batteryLow: "#d7352b",
  selection: "#3E8A72",
  switcherSelection: "#1d1d1f24",
  button: "#1d1d1f12",
  checkbox: "#1d1d1f66",
  critical: "#d4483b",
  tile: "#ffffffb8",
  tileHover: "#ffffffe6",
  track: "#1d1d1f1f",
  agent: "#6E56CF",
  agentInk: "#3B2A8A",
  agentWash: "#6E56CF24",
  captureWash: "#d4483b24",
};

/**
 * macOS's dark look: translucent graphite glass, #f5f5f7 ink, hairlines of
 * white. The accent and shiso stay (brighter shiso ink, for contrast on glass).
 */
export const darkColors: Palette = {
  text: "#f5f5f7",
  textMuted: "#f5f5f799",
  textDisabled: "#f5f5f755",
  menuBar: "#1e1e1ecc",
  menuBarEdge: "#ffffff1f",
  dock: "#1e1e1e99",
  dockBorder: "#ffffff26",
  hover: "#ffffff1a",
  separator: "#ffffff1a",
  dot: "#f5f5f7cc",
  launcher: "#1e1e1eeb",
  menu: "#232325f7",
  osd: "#1e1e1ee0",
  osdOn: "#f5f5f7d9",
  osdOff: "#f5f5f726",
  batteryLow: "#ff5a4f",
  selection: "#3E8A72",
  switcherSelection: "#ffffff24",
  button: "#ffffff1f",
  checkbox: "#f5f5f766",
  critical: "#ff5a4f",
  tile: "#ffffff17",
  tileHover: "#ffffff29",
  track: "#ffffff2e",
  agent: "#8B76E8",
  agentInk: "#cfc6f7",
  agentWash: "#8B76E83d",
  captureWash: "#ff5a4f3d",
};

/** The palette for the Dark Mode switch. */
export function paletteFor(dark: boolean): Palette {
  return dark ? darkColors : lightColors;
}

/**
 * The palette to paint with right now. Control Center's Dark Mode switch is
 * the source; every surface calls this in render, so flipping it repaints all
 * of them (they share one Bun process) without a restart.
 */
export function useColors(): Palette {
  return paletteFor(useFlags(controlFlags()).dark);
}
