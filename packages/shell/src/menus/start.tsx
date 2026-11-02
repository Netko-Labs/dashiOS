/**
 * Brings the menu bar's menus, Control Center, and the notification center
 * to life: the popover surface, the sheets, and what choosing a row does, wired to the
 * compositor, the arranger, the lock screen, and the system.
 */

import pkg from "../../package.json" with { type: "json" };
import { ownerPids } from "../app-menus/focus.ts";
import { AppMenuStore } from "../app-menus/store.ts";
import { type App, appFor, iconPath } from "../apps.ts";
import type { Arranger } from "../arrange.ts";
import { PairingPrompt } from "../bluetooth/prompt.tsx";
import type { BluetoothSetup } from "../bluetooth/select.ts";
import { BluetoothStore } from "../bluetooth/store.ts";
import type { Compositor, CompositorWindow } from "../compositor.ts";
import { controlFlags, DeviceStore, radiosFor } from "../control-center/index.ts";
import type { DockMenuAction } from "../dock/menu.ts";
import { type Entry, launchEntry, loadEntries } from "../entries.ts";
import type { NotificationStore } from "../notifications/index.ts";
import { openOverlay } from "../overlay.tsx";
import type { SharedStores } from "../settings-app/services.ts";
import { SoundStore, soundBackendFor } from "../sound/index.ts";
import { run as runCommand } from "../system/exec.ts";
import type { SystemStore } from "../system/store.ts";
import { chooseNetwork } from "../wifi/flow.ts";
import { PasswordPrompt } from "../wifi/prompt.tsx";
import type { WifiSetup } from "../wifi/select.ts";
import type { WifiStore } from "../wifi/store.ts";
import { type AboutTarget, type ActionDeps, runMenuAction } from "./actions.ts";
import { MenuController } from "./controller.ts";
import { Dialogs } from "./dialogs.tsx";
import { findEntry, helpCommand, spawnDetached } from "./launch.ts";
import { type MenuAction, type MenuContext, type PowerKind, type WindowMenu, windowMenus } from "./model.ts";
import { PopoverRoot, popoverSurface } from "./popover.tsx";
import { runPower } from "./session.ts";
import type { AboutInfo } from "./sheets.tsx";
import type { StatusMenuAction } from "./status-menu.ts";

/** The popover is gone this long before the lock screen or a sleep starts, so neither shows it. */
const SETTLE_MS = 150;

export interface MenusOptions {
  apps: readonly App[];
  /** The installed apps, shared with the Dock and kept current (app-catalog.ts); read once here when absent. */
  catalog?: readonly Entry[];
  compositor: Compositor | null;
  arranger: Arranger | null;
  system: SystemStore;
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
  /** Carries out a chosen row of a Dock icon's menu (dock/). */
  runDock(action: DockMenuAction): void;
  /** Carries out a chosen row of a status item's menu (an extra's or the battery's). */
  runStatus(action: StatusMenuAction): void;
  /** A status item's menu closed. */
  statusClosed?(key: string): void;
  /** How much of that screen's bottom the Dock takes now (dock/presenter.ts `bottomInset`); the notification center stops above it. */
  dockInset?(output?: string): number;
  /** The menus apps published (app-menus/); without it the bar has only Dashi's. */
  appMenus?: AppMenuStore;
}

export interface Menus {
  controller: MenuController;
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

export function aboutInfo(target: AboutTarget, icon: string | undefined): AboutInfo {
  if (target.kind === "dashi") {
    return {
      title: "Dashi",
      lines: [`Version ${pkg.version}`, "A Linux desktop on mirin metal:", "a Rust compositor and a TypeScript shell."],
    };
  }
  return {
    title: target.name,
    icon: icon ?? iconPath("generic"),
    lines: [target.appId || "No app id", ...(target.pid === null ? [] : [`Process ${target.pid}`])],
  };
}

export function startMenus(options: MenusOptions): Menus {
  const { compositor } = options;
  const appMenus = options.appMenus ?? new AppMenuStore();
  let entries: readonly Entry[] | null = options.catalog ?? null;
  const entryFor = (appId: string) => findEntry((entries ??= loadEntries()), appId);

  // The sheet names the app the menu was opened over, which no longer has the keyboard.
  let lastAppName = "Desktop";
  const dialogs = new Dialogs(openOverlay, runPower);
  // On a development run the radios' switches write to memory, never to the developer's machine.
  const radios = radiosFor({
    standIn: options.wifi.fake || options.bluetooth.fake,
    run: runCommand,
    wifi: options.wifi.radio,
    bluetooth: options.bluetooth.radio,
  });
  const devices = new DeviceStore({
    volumeChanged: (volume) => options.system.publish("volume", volume),
    wifiRadio: radios.wifi,
    bluetoothRadio: radios.bluetooth,
    // The Bluetooth radio asks BlueZ itself (and falls back to bluetoothctl, which may be missing).
    hasBluetoothctl: true,
  });
  const wifi = options.wifiStore;
  // On a development run the output switch is remembered in memory, never made the default on the developer's machine.
  const audio = soundBackendFor({ standIn: options.wifi.fake, run: runCommand });
  const sound = new SoundStore(audio);
  const passwords = new PasswordPrompt(openOverlay, wifi);
  const bluetooth = new BluetoothStore(options.bluetooth.backend);
  // BlueZ's pairing questions (compare a code, type a PIN) come to the store and show on a sheet.
  options.bluetooth.backend.setPairingHandler(bluetooth);
  const pairing = new PairingPrompt(openOverlay, bluetooth, () => controller.close());
  pairing.start();

  const context = async (appName: string): Promise<MenuContext> => {
    const windows = await (compositor?.windows() ?? Promise.resolve([])).catch(() => []);
    const focused = windows.find((window) => window.focused) ?? null;
    return {
      appName,
      windows,
      focused,
      canLaunch: focused !== null && entryFor(focused.appId) !== undefined,
      canOpenHelp: helpCommand() !== null,
    };
  };

  const controller: MenuController = new MenuController({
    context,
    openSurface: (onClosed, output) =>
      openOverlay(
        { title: "Menu", width: 1, height: 1, surface: popoverSurface(output) },
        <PopoverRoot
          controller={controller}
          appMenus={appMenus}
          controlCenter={{
            flags: controlFlags(),
            devices,
            system: options.system,
            wifi,
            sound,
            bluetooth,
            onJoin: (network) =>
              void chooseNetwork(wifi, network, (secured) => {
                // The sheet takes the keyboard; the popover would only sit in its way.
                controller.close();
                passwords.ask(secured);
              }),
            onLock: () => {
              controller.close();
              setTimeout(options.lock, SETTLE_MS);
            },
          }}
          notifications={options.notifications}
          dockInset={(output) => options.dockInset?.(output) ?? 0}
          onChoose={(action, appName) => {
            lastAppName = appName;
            run(action);
          }}
          onDockChoose={options.runDock}
          onStatusChoose={options.runStatus}
          onStatusClosed={(key) => options.statusClosed?.(key)}
        />,
        onClosed,
      ),
  });

  const confirmPower = (what: PowerKind) => dialogs.confirm(what);
  // While the notification center is open the banners are in it, so none show.
  const syncCenter = () => options.notifications.setCenterOpen(controller.getSnapshot().popover?.kind === "notification-center");
  const stopSyncingCenter = controller.subscribe(syncCenter);

  const deps: ActionDeps = {
    compositor,
    arranger: options.arranger,
    lock: () => void setTimeout(options.lock, SETTLE_MS),
    launchApp: (appId) => {
      const entry = entryFor(appId);
      return entry ? launchEntry(entry) !== null : false;
    },
    showAbout: (target) => dialogs.about(aboutInfo(target, target.kind === "app" ? entryFor(target.appId)?.icon : undefined)),
    confirmPower,
    suspend: () => void setTimeout(options.sleep, SETTLE_MS),
    openHelp: () => {
      const command = helpCommand();
      if (command) spawnDetached(command);
    },
    showShortcuts: () => options.showShortcuts(lastAppName),
    openForceQuit: () => options.openForceQuit(),
    openSettings: () => options.openSettings?.(),
    selectAppItem: (pid, id) => void appMenus.select(pid, id),
  };

  const run = (action: MenuAction): void => {
    runMenuAction(action, deps).catch((error) => console.error(`dashi-shell: menu action “${action.kind}” failed:`, error));
  };

  const menusOf = async (window: CompositorWindow): Promise<WindowMenu[]> => {
    const windows = await (compositor?.windows() ?? Promise.resolve([])).catch(() => []);
    const appName = appFor(options.apps, window, entryFor).name;
    const app = appMenus.menusFor(ownerPids(window.pid));
    const ctx: MenuContext = {
      appName,
      windows,
      focused: window,
      canLaunch: entryFor(window.appId) !== undefined,
      canOpenHelp: helpCommand() !== null,
      app,
    };
    return windowMenus(ctx);
  };

  return {
    controller,
    shared: {
      wifi,
      devices,
      bluetooth,
      sound,
      audio,
      // The popover is not up when Settings asks, so there is nothing to close first.
      askWifiPassword: (network) => passwords.ask(network),
    },
    confirmPower,
    menusOf,
    run: (action, appName) => {
      lastAppName = appName;
      return runMenuAction(action, deps);
    },
    dismissAll() {
      controller.close();
      dialogs.close();
      passwords.close();
      pairing.dismiss();
    },
    close() {
      controller.close();
      stopSyncingCenter();
      dialogs.close();
      passwords.close();
      sound.close();
      pairing.close();
      options.wifi.backend.close();
      options.bluetooth.backend.close();
    },
  };
}
