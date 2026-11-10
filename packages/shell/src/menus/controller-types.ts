/** What the menu controller holds and is given: the popover that is open, the state a surface draws, and what it is given to run. */

import type { ControlPage } from "../control-center/index.ts";
import type { DockMenuAction } from "../dock/menu.ts";
import type { OverlayHandle } from "../overlay.tsx";
import type { BarStop } from "./bar-keys.ts";
import type { BarMenuId, MenuContext, MenuEntry } from "./model.ts";
import type { StatusMenuAction } from "./status-menu.ts";

export type Popover =
  | { kind: "menu"; id: BarMenuId; x: number }
  /** An app's menu in the Dock: its rows were built when it opened; `x` is the icon's center. */
  | { kind: "dock-menu"; x: number; entries: readonly MenuEntry<DockMenuAction>[]; above?: number }
  | { kind: "control-center"; page: ControlPage }
  /** The battery panel (battery/panel.tsx), its right edge at `right` (screen pixels), or where Control Center is when null. */
  | { kind: "battery"; right: number | null }
  | { kind: "notification-center" }
  /** The agents' panel under their mark (agents-panel.tsx), its right edge at `right`; `focus` is the run it opened on. */
  | { kind: "agents"; right: number; focus: string | null }
  /** A status item's menu (an extra's or the battery's), its right edge at `right` (screen pixels); `key` says whose. */
  | { kind: "status-menu"; key: string; right: number; entries: readonly MenuEntry<StatusMenuAction>[] }
  /** "…": the status items that didn't fit, in a row under it (bar-overflow.tsx), its right edge at `right`. */
  | { kind: "overflow"; right: number; keys: readonly string[] };

export interface MenuState {
  popover: Popover | null;
  /** The app name the bar showed when the popover opened; null while closed. */
  appName: string | null;
  context: MenuContext | null;
  /** The screen the popover is on (an output name); absent when the bar did not say, which is the compositor's choice. */
  output?: string;
  /**
   * The keyboard is in that screen's bar (bar-keys.ts, ⌃F2): the stop the
   * ring is on, while the popover surface holds the keys, with or without a
   * popover open. Absent otherwise.
   */
  bar?: string;
}

/** What a bar tells the controller about itself (menubar.tsx): its stops in order, and the app name it shows. */
export interface BarInfo {
  appName: string;
  stops: readonly BarStop[];
}

export interface ControllerDeps {
  /** Reads the desktop for the menus (before the surface takes the keyboard). */
  context(appName: string): Promise<MenuContext>;
  /** Opens the popover surface on that screen; `onClosed` runs when it goes, however it went. */
  openSurface(onClosed: () => void, output?: string): OverlayHandle;
}
