/** What the menus are given to run (start.tsx), and what they give back. */

import type { ReactElement } from "react";
import type { AppMenuStore } from "../app-menus/store.ts";
import type { App } from "../apps.ts";
import type { Arranger } from "../arrange/index.ts";
import type { BatteryPopoverSources } from "../battery/popover.tsx";
import type { BluetoothSetup } from "../bluetooth/select.ts";
import type { Compositor, CompositorWindow } from "../compositor.ts";
import type { AppletTileSource, ControlCenterProps, LayoutStore } from "../control-center/index.ts";
import type { MirrorStore } from "../display-config/mirror.ts";
import type { DockMenuAction } from "../dock/types.ts";
import type { Entry } from "../entries.ts";
import type { Laptop } from "../laptop/index.ts";
import type { NotificationStore } from "../notifications/index.ts";
import type { SharedStores } from "../settings-app/services.ts";
import type { AppMixer, PipeWireWatch } from "../sound/apps/index.ts";
import type { SystemStore } from "../system/store.ts";
import type { WifiSetup } from "../wifi/select.ts";
import type { WifiStore } from "../wifi/store.ts";
import type { MenuController } from "./controller.ts";
import type { StatusMenuAction } from "./status-menu.ts";
import type { MenuAction, PowerKind, WindowMenu } from "./types.ts";

/** The installed app with this app id, if any. */
export type EntryFor = (appId: string) => Entry | undefined;

/** Control Center's props but the ones the popover supplies (page, close, battery). */
export type ControlCenterStores = Omit<ControlCenterProps, "page" | "onPage" | "onClose" | "onBattery">;

export interface MenusOptions {
  apps: readonly App[];
  /** The installed apps, shared with the Dock and kept current (app-catalog.ts); read once here when absent. */
  catalog?: readonly Entry[];
  compositor: Compositor | null;
  arranger: Arranger | null;
  /** The Desktops, for the Window menu's "Move to" rows (spaces/). */
  desktops?: {
    getSnapshot(): { labels: readonly string[]; current: number; fullscreen?: readonly (number | null)[] };
    move(window: number, space: number | "new"): Promise<void>;
  };
  system: SystemStore;
  /** Control Center's slider set the brightness to `level` (0..1): at 0 the built-in screen goes off. */
  brightnessChanged?: (level: number) => void;
  /** What the notification center lists; it also hears when the center opens (banners go away then). */
  notifications: NotificationStore;
  /** What Wi-Fi is wired to: NetworkManager, or the stand-in of a development run. */
  wifi: WifiSetup;
  /** The Wi-Fi list and joins; agents use the same store (agents/desktop/). */
  wifiStore: WifiStore;
  /** What Bluetooth is wired to: BlueZ, or the stand-in of a development run. */
  bluetooth: BluetoothSetup;
  lock(): void;
  /** The Sleep row: locks the screen, then suspends (power/). */
  sleep(): void;
  /** Shows the shortcut sheet for the app with this name. */
  showShortcuts(appName: string): void;
  /** Opens Force Quit Applications. */
  openForceQuit(): void;
  /** Opens System Settings. */
  openSettings?(): void;
  /** Opens the launcher (Search… in the Dashi menu). */
  openSearch?(): void;
  /** Carries out a chosen row of a Dock icon's menu (dock/). */
  runDock(action: DockMenuAction): void;
  /** Carries out a chosen row of a status item's menu (an extra's or the battery's). */
  runStatus(action: StatusMenuAction): void;
  /** A status item's menu closed. */
  statusClosed?(key: string): void;
  /** The agents' panel under their mark (agents-panel.tsx). */
  agentsPanel?: (props: { right: number; focus: string | null; close: () => void }) => ReactElement;
  /** "…"'s row of the status items that didn't fit (bar-overflow.tsx). */
  overflowRow?: (props: { right: number; keys: readonly string[]; close: () => void; escape: () => void }) => ReactElement;
  /** The Metal host takes accessibility props (launcher/access.ts): the bar's ring is spoken. */
  accessible?: () => boolean;
  /** How much of that screen's bottom the Dock takes now (dock/presenter.ts `bottomInset`); the notification center stops above it. */
  dockInset?(output?: string): number;
  /** The menus apps published (app-menus/); without it the bar has only Dashi's. */
  appMenus?: AppMenuStore;
  /** The laptop's stores, for Control Center's laptop tiles (laptop/). */
  laptop?: Laptop;
  /** Control Center's layout on this machine; one in memory when absent (tests). */
  layout?: LayoutStore;
  /** Applets' controls in Control Center (applets/controls.ts). */
  appletControls?: AppletTileSource;
  /** The charge limit in percent now, or null (the battery row's and panel's tick). */
  chargeLimit?: () => number | null;
  /** Mirroring the screens (display-config/mirror.ts), for Control Center's Mirroring tile. */
  mirror?: MirrorStore;
  /** The battery panel's stores and rows (battery/popover.tsx); without them the battery item opens nothing. */
  battery?: Omit<BatteryPopoverSources, "onApp" | "onAction" | "onSettings" | "chargeLimit">;
  /** System Settings at a pane ("network", "battery", "control-center"). */
  openSettingsPane?(pane: string): void;
  /** The apps' sound (sound/apps/), for Control Center's Sound page and Settings › Sound. */
  mixer?: AppMixer;
  /** The session's PipeWire watcher: the outputs and Control Center's slider follow it (sound/apps/watch.ts). */
  pipewire?: PipeWireWatch;
}

export interface Menus {
  controller: MenuController;
  /** Control Center's stores and layout, as the panel has them (Settings › Control Center edits with them). */
  controlCenter: ControlCenterStores;
  /** The stores Control Center runs, which System Settings' machine panes share. */
  shared: SharedStores;
  /** Asks first, in the menus' sheet, then restarts, shuts down, or logs out. */
  confirmPower(what: PowerKind): void;
  /** Takes down whatever the menus have on screen (the screen locked); nothing the sheets asked is carried out. */
  dismissAll(): void;
  /**
   * The menus the bar shows while `window` is focused, the Dashi menu aside:
   * the app menu, then the app's own or Dashi's generic ones, Window, Help
   * (for agents, agents/desktop/menus.ts).
   */
  menusOf(window: CompositorWindow): Promise<WindowMenu[]>;
  /** Carries out a row of `menusOf`, as choosing it in the bar does. */
  run(action: MenuAction, appName: string): Promise<void>;
  close(): void;
}
