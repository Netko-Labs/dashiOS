/**
 * The menus' public types: the titles, the actions a row can carry, and the context a menu is
 * built from (model.ts builds them); the popover that is open and the state a surface draws
 * (controller.ts holds them).
 */

import type { CompositorWindow } from "../compositor/index.ts";
import type { ControlPage } from "../control-center/index.ts";
import type { DockMenuAction } from "../dock/types.ts";
import type { Arrange, Tile } from "../layout.ts";
import type { OverlayHandle } from "../overlay.tsx";
import type { PublishedMenus } from "../shared/app-menus/index.ts";
import type { BarStop } from "./bar-keys.ts";
import type { StatusMenuAction } from "./status-menu.ts";

/** What a row of the Edit menu types in the focused app (lib/keystrokes.ts has the chords). */
export type EditCommand = "undo" | "redo" | "cut" | "copy" | "paste" | "select-all" | "find";

export type MenuId = "dashi" | "app" | "file" | "edit" | "view" | "window" | "help";
/** A menu an app published (app-menus/), by its id: "app:file". */
export type AppMenuKey = `app:${string}`;
/** Any title in the bar. */
export type BarMenuId = MenuId | AppMenuKey;

/** What asks first, then ends the session or the machine. */
export type PowerKind = "restart" | "shutdown" | "logout";

export type MenuAction =
  | { kind: "about-dashi" }
  | { kind: "about-app"; appId: string; name: string; pid: number | null }
  | { kind: "sleep" }
  | { kind: "power"; what: PowerKind }
  | { kind: "lock" }
  | { kind: "force-quit" }
  /** Open the launcher (launcher.tsx). */
  | { kind: "search" }
  | { kind: "settings" }
  | { kind: "hide-app"; window: number }
  | { kind: "hide-others"; window: number }
  /** Unhide every hidden app; `window` gets the focus back. */
  | { kind: "show-all"; window: number | null }
  | { kind: "quit-app"; window: number }
  | { kind: "new-window"; appId: string }
  | { kind: "close-window"; window: number }
  | { kind: "minimize"; window: number }
  /** Enter full screen, or leave it. */
  | { kind: "fullscreen"; window: number }
  /** Type the app's chord for an Edit row into the window (keystrokes.ts). */
  | { kind: "edit"; window: number; command: EditCommand }
  /** Tile, fill, center, or back to its own frame (arrange.ts). */
  | { kind: "tile"; window: number; tile: Arrange }
  /** Put the window on Desktop `space` (from 0), or on a new one. */
  | { kind: "move-to-space"; window: number; space: number | "new" }
  | { kind: "bring-to-front"; window: number }
  | { kind: "focus"; window: number }
  | { kind: "help" }
  | { kind: "shortcuts" }
  /** An app's own row: the app is told (app-menus/). */
  | { kind: "app-item"; pid: number; id: string; personOnly?: true };

/** A row; `A` is what choosing it does (the Dock's menu has its own actions). */
export type MenuEntry<A = MenuAction> =
  | { kind: "separator" }
  | {
      kind: "item";
      label: string;
      /** Written the Mac way ("⇧❖Z"); only shown, never bound here. */
      keys?: string;
      checked?: boolean;
      action: A | null;
    };

/** What the menus are built from; read when one opens, kept while it is open. */
export interface MenuContext {
  /** The focused app's name as the menu bar shows it ("Desktop" with none). */
  appName: string;
  /** Every window, front to back. */
  windows: readonly CompositorWindow[];
  /** The window that had the keyboard, null with none. */
  focused: CompositorWindow | null;
  /** The app can be started again (a launcher entry exists for it). */
  canLaunch: boolean;
  /** Help can be opened (xdg-open and the README exist). */
  canOpenHelp: boolean;
  /** The menus the focused app published (app-menus/); absent or null with none. */
  app?: PublishedMenus | null;
  /** The Desktops, by what each is called (spaces/names.ts), and the one that shows; absent without them. `fullscreen` says which are full-screen windows' own (spaces/lib/slots.ts). */
  desktops?: { labels: readonly string[]; current: number; fullscreen?: readonly (number | null)[] };
  /** How the focused window is arranged (arrange.ts): a tile or Fill; absent or null at its own frame. */
  arrangement?: Tile | null;
}

/** One title of the bar and its rows, as built for a window. */
export interface WindowMenu {
  id: BarMenuId;
  title: string;
  entries: MenuEntry[];
}

export type Popover =
  | { kind: "menu"; id: BarMenuId; x: number }
  /** An app's menu in the Dock: its rows were built when it opened; `x` is the icon's center. */
  | { kind: "dock-menu"; x: number; entries: readonly MenuEntry<DockMenuAction>[]; above?: number }
  | { kind: "control-center"; page: ControlPage }
  /** The battery panel (battery/panel.tsx), its right edge at `right` (screen pixels), or where Control Center is when null. */
  | { kind: "battery"; right: number | null }
  | { kind: "notification-center" }
  /** The agents' panel under their mark (agents-panel/agents-panel.tsx), its right edge at `right`; `focus` is the run it opened on. */
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
