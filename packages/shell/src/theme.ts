/**
 * The shell's metrics: macOS proportions for the menu bar, the Dock, and the
 * taskbar. The palettes are @dashi/ui's (`useColors`).
 */

import { RADIUS, SPACE } from "@dashi/ui";

export const MENU_BAR_HEIGHT = 28;

export const DOCK = {
  icon: 48,
  gap: SPACE.s,
  /** Panel padding around the icons; the bottom leaves room for the dot. */
  paddingX: SPACE.m,
  paddingTop: SPACE.s,
  paddingBottom: SPACE.xs,
  dot: 4,
  radius: RADIUS.dock,
  /** Gap between the Dock and the bottom edge. */
  margin: SPACE.s,
} as const;

/** The Dock panel's height: icon, the running dot under it, and padding. */
export const DOCK_HEIGHT = DOCK.paddingTop + DOCK.icon + 3 + DOCK.dot + DOCK.paddingBottom;

/** The taskbar style of the Dock (dock/lib/taskbar.tsx): a bar across the screen's bottom edge. */
export const TASKBAR = {
  height: 48,
  /** A window's button: icon, then its title. */
  buttonHeight: 38,
  buttonMaxWidth: 180,
  icon: 24,
  radius: 8,
} as const;
