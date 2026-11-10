/**
 * The pieces start-up makes after something that calls them (main.tsx, boot/services.ts `Late`).
 * Each is reached through a callback that only runs once the shell is up: the power key asks
 * through the menus, which start after it; Settings lists the clipboard's history, which starts
 * with the launcher. Types only: nothing here loads at start.
 */

import type { Actions } from "../actions/index.ts";
import type { Ask } from "../agents/ask/types.ts";
import type { Agents } from "../agents/server.ts";
import type { AppMenus } from "../app-menus/index.ts";
import type { BatteryMonitor } from "../battery/monitor.ts";
import type { Clipboard } from "../clipboard/start.ts";
import type { CompositorWindow } from "../compositor.ts";
import type { AutoRefresh } from "../display-config/auto-refresh.ts";
import type { Entry } from "../entries.ts";
import type { Extensions } from "../extensions/index.ts";
import type { FullscreenBars } from "../fullscreen.ts";
import type { Laptop } from "../laptop/start.ts";
import type { LauncherHost } from "../launcher/host.ts";
import type { LauncherWorld } from "../launcher/world.ts";
import type { MenuBars } from "../menubars.ts";
import type { Menus } from "../menus/index.ts";
import type { OverlaySlots } from "../overlay-slots.ts";
import type { OverviewController } from "../overview/index.ts";
import type { SettingsApp } from "../settings-app/index.ts";
import type { ControlCenterEditor } from "../settings-app/panes/control-center.tsx";
import type { SetupAssistant } from "../setup/start.tsx";
import type { Clipboard as SystemClipboard } from "../shared/clipboard/clipboard.ts";
import type { LauncherOpener } from "./launcher.tsx";
import type { OverlayKind } from "./overlays.tsx";

export interface LateParts {
  overview: OverviewController | null;
  fullscreenBars: FullscreenBars | null;
  menuBars: MenuBars;
  menus: Menus;
  agents: Agents | null;
  actions: Actions;
  settingsApp: SettingsApp;
  setupAssistant: SetupAssistant;
  installedApp: (appId: string) => Entry | undefined;
  /** What the Dock calls a window's app, for Desktops named after their apps; set once the app catalog is read. */
  nameApp: (window: CompositorWindow) => string;
  appMenus: AppMenus;
  /** Chooses the item of a window's app menus that shows a shortcut. */
  appShortcut: (window: number, shortcut: string) => Promise<boolean>;
  batteryMonitor: BatteryMonitor;
  laptop: Laptop;
  autoRefresh: AutoRefresh | null;
  controlCenterEditor: ControlCenterEditor;
  overlays: OverlaySlots<OverlayKind>;
  launcher: LauncherOpener;
  /** Copying an answer from the launcher (wl-copy). */
  launcherClipboard: SystemClipboard;
  /** Whether the Metal host publishes an accessibility tree (launcher/access.ts). */
  launcherAccess: { accessible: boolean };
  openWith: (appId: string, env: Record<string, string>) => boolean;
  openSheet: (pinned?: boolean, appName?: string) => void;
  clipboard: Clipboard;
  extensions: Extensions;
  launcherWorld: LauncherWorld;
  launcherHost: LauncherHost;
  askAgents: Ask;
  /** Ends the shell: every service stopped, the last started first. */
  quit: () => void;
}
