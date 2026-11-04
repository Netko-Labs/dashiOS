/**
 * The parts of the desktop agents reach besides windows: the stores and
 * controllers the shell already runs for the person. Each is the same object
 * the menu bar, Control Center, or Force Quit uses, so an agent's change is
 * what the person would have made, and they see it happen.
 */

import type { CompositorWindow } from "../../compositor.ts";
import type { FlagsStore } from "../../control-center/flags.ts";
import type { CornerName } from "../../corners.ts";
import type { DisplayManager } from "../../display-config/manager.ts";
import type { DockPrefs } from "../../dock/prefs.ts";
import type { ForceQuit } from "../../force-quit/start.tsx";
import type { MenuAction, WindowMenu } from "../../menus/model.ts";
import type { NotificationStore } from "../../notifications/store.ts";
import type { ScreenRecorder } from "../../recorder/recorder.ts";
import type { RegionDesktop } from "../../region/desktop.ts";
import type { MachineDesktop } from "../../settings-app/machine-desktop.ts";
import type { PageId } from "../../setup/flow.ts";
import type { WifiStore } from "../../wifi/store.ts";
import type { SoftwareBackend } from "./software.ts";

export interface Desktop {
  /** The notification center's history, and taking notifications out of it. */
  notifications: Pick<NotificationStore, "getSnapshot" | "remove">;
  /** Control Center's switches (Dark Mode, Do Not Disturb). */
  flags: Pick<FlagsStore, "getSnapshot" | "set">;
  /** The Dock's settings (autohide, style): the store the Dock's menu and System Settings change. Absent where there is no Dock. */
  dock?: Pick<DockPrefs, "snapshot" | "set">;
  /** The Wi-Fi menu's list and joins. */
  wifi: Pick<WifiStore, "getSnapshot" | "refresh" | "rescan" | "join" | "dismissFailure">;
  /** What Force Quit Applications lists, and ending one of those. */
  forceQuit: Pick<ForceQuit, "apps" | "end">;
  /** The display arrangement (display-config/): resolution, rotation, main display, positions. Absent without a compositor. */
  displays?: Pick<DisplayManager, "monitors" | "setMode" | "setRotation" | "setPrimary" | "arrange">;
  /** Remember a screen's scale as Settings does, so the next start keeps what was set. */
  rememberScale(name: string, scale: number): void;
  /** How round windows are, as Settings' Appearance pane has it; setting it saves to settings.json, and the shell follows the file. */
  corners: { get(): CornerName; set(name: CornerName): void };
  /** Scrolling speed per kind of device (scroll-speed.ts), as Settings' Trackpad and Mouse panes have it; 1 with none saved. */
  scrollSpeed: { get(device: "trackpad" | "mouse"): number; set(device: "trackpad" | "mouse", factor: number): void };
  /** What the menu bar shows (settings.json `menuBar`), as Settings' Battery & Power and Sound panes have it. */
  menuBar: { get(): { batteryPercent: boolean; sound: boolean }; set(change: { batteryPercent?: boolean; sound?: boolean }): void };
  /** Network, Bluetooth, sound, power, and the account: the machine panes' stores (settings-app/machine-desktop.ts). */
  machine: MachineDesktop;
  /** Time zone, 24-hour time, and region formats, as Settings' Date & Time and Language & Region panes have them. */
  region: RegionDesktop;
  /** The Setup Assistant: showing it is all an agent can do with it. */
  setup: { open(page?: PageId): void };
  /** The app catalog and the package tools; absent means the real ones (software/). */
  software?: SoftwareBackend;
  /** Show the lock screen. */
  lock(): void;
  /** The shell's screen recorder, for record_screen (recorder/). Absent without a compositor. */
  recorder?: ScreenRecorder;
  /** Choose the item of `window`'s app menus that shows `shortcut` ("⇧❖N"); false when none does (app-menus/). */
  appShortcut?(window: number, shortcut: string): Promise<boolean>;
  /** The menu bar's menus for a window (its app's own included), and choosing a row. Absent where there is no menu bar. */
  menus?: {
    of(window: CompositorWindow): Promise<WindowMenu[]>;
    run(action: MenuAction, appName: string): Promise<void>;
  };
}
