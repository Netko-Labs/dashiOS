/**
 * The parts of the desktop agents reach besides windows: the stores and
 * controllers the shell already runs for the person. Each is the same object
 * the menu bar, Control Center, or Force Quit uses, so an agent's change is
 * what the person would have made, and they see it happen.
 */

import type { CompositorWindow } from "../../compositor.ts";
import type { DisplayManager } from "../../display-config/manager.ts";
import type { DockPrefs } from "../../dock/prefs.ts";
import type { ForceQuit } from "../../force-quit/index.ts";
import type { MenuAction, WindowMenu } from "../../menus/index.ts";
import type { NotificationStore } from "../../notifications/store.ts";
import type { ScreenRecorder } from "../../recorder/index.ts";
import type { RegionDesktop } from "../../region/desktop.ts";
import type { MachineDesktop } from "../../settings-app/machine-desktop.ts";
import type { SettingsStore } from "../../settings-app/store.ts";
import type { PageId } from "../../setup/flow.ts";
import type { FlagsStore } from "../../shared/control-center/flags.ts";
import type { WifiStore } from "../../wifi/store.ts";
import type { SoftwareBackend } from "./software.ts";

/** One copy as an agent reads it: the text, or what a picture or files were. */
export interface ClipboardCopy {
  kind: "text" | "image" | "files";
  /** The text (cut short), the files' paths, or a picture's size. */
  text: string;
  app: string | null;
  /** When it was copied (ISO 8601). */
  copiedAt: string;
  pinned: boolean;
}

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
  /** The Desktops as the shell names them, full-screen windows' own included (spaces/). Absent without them. */
  spaces?: { getSnapshot(): { labels: readonly string[]; fullscreen: readonly (number | null)[] } };
  /** The display arrangement (display-config/): resolution, rotation, main display, positions. Absent without a compositor. */
  displays?: Pick<DisplayManager, "monitors" | "setMode" | "setRotation" | "setPrimary" | "arrange">;
  /** Remember a screen's scale as Settings does, so the next start keeps what was set. */
  rememberScale(name: string, scale: number): void;
  /** settings.json, as System Settings writes it: the registry's rows agents may change (get_settings, set_setting) read and write it; the shell follows the file. */
  settings: Pick<SettingsStore, "getSnapshot" | "patch">;
  /** Network, Bluetooth, sound, power, and the account: the machine panes' stores (settings-app/machine-desktop.ts). */
  machine: MachineDesktop;
  /** Time zone, 24-hour time, and region formats, as Settings' Date & Time and Language & Region panes have them. */
  region: RegionDesktop;
  /** The Setup Assistant: showing it is all an agent can do with it. */
  setup: { open(page?: PageId): void };
  /** The app catalog and the package tools; absent means the real ones (shared/software/). */
  software?: SoftwareBackend;
  /** Show the lock screen. */
  lock(): void;
  /** The shell's screen recorder, for record_screen (recorder/). Absent without a compositor. */
  recorder?: ScreenRecorder;
  /** The clipboard history, newest first (clipboard/); absent where it isn't kept. */
  clipboard?: { recent(limit: number): ClipboardCopy[] };
  /** Choose the item of `window`'s app menus that shows `shortcut` ("⇧❖N"); false when none does (app-menus/). */
  appShortcut?(window: number, shortcut: string): Promise<boolean>;
  /** The menu bar's menus for a window (its app's own included), and choosing a row. Absent where there is no menu bar. */
  menus?: {
    of(window: CompositorWindow): Promise<WindowMenu[]>;
    run(action: MenuAction, appName: string): Promise<void>;
  };
}
