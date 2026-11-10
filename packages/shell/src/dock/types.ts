/** The Dock's public types: what its icons' menus ask the shell to do. */

import type { DockSettings } from "./settings.ts";

export type DockMenuAction =
  /** Bring a window forward (restoring it if minimized); `window` is a toplevel id. */
  | { kind: "focus"; window: number }
  | { kind: "pin"; appId: string }
  | { kind: "unpin"; appId: string }
  | { kind: "open"; appId: string }
  /** Hide the app's windows; `key` is the entry's (layout.ts `appKey`). */
  | { kind: "hide"; key: string }
  /**
   * Quit the app: every window whose `key` (layout.ts `appKey`) is the
   * entry's is asked to close. `windows` are its toplevel ids, used only
   * when the compositor cannot name them (controller.ts).
   */
  | { kind: "quit"; key: string; windows: readonly number[] }
  /** Change the Dock's own settings (settings/settings.ts). */
  | { kind: "dock-prefs"; change: Partial<DockSettings> }
  /** Open System Settings on the Desktop & Dock pane. */
  | { kind: "dock-settings" };
