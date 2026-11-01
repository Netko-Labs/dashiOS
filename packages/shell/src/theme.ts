/**
 * The shell's metrics: macOS proportions for the menu bar, the Dock, and the
 * taskbar. The palettes are @dashi/ui's (`useColors`).
 */

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
