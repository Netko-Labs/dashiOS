/**
 * Brings the menu bar's menus, Control Center, and the notification center
 * to life: the popover surface, the sheets, and what choosing a row does, wired to the
 * compositor, the arranger, the lock screen, and the system.
 */

import type { ReactElement } from "react";
import pkg from "../../package.json" with { type: "json" };
import { ownerPids } from "../app-menus/focus.ts";
import { AppMenuStore } from "../app-menus/store.ts";
import { type App, appFor, iconPath } from "../apps.ts";
import { type Arranger, parseOutputs } from "../arrange.ts";
import { holdingBar } from "../bar-hold.ts";
import type { BatteryPopoverSources } from "../battery/popover.tsx";
import { PairingPrompt } from "../bluetooth/prompt.tsx";
import type { BluetoothSetup } from "../bluetooth/select.ts";
import { BluetoothStore } from "../bluetooth/store.ts";
import type { Compositor, CompositorWindow } from "../compositor.ts";
import { type AppletTileSource, type ControlCenterProps, controlFlags, DeviceStore, LayoutStore, radiosFor } from "../control-center/index.ts";
import type { DockMenuAction } from "../dock/menu.ts";
import { type Entry, launchEntry, loadEntries } from "../entries.ts";
import type { Laptop } from "../laptop/start.ts";
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
import { ACTIVITY_MONITOR, type EnergyApp, energyArgs, openActivityMonitor } from "./activity-monitor.ts";
import { MenuController } from "./controller.ts";
import { Dialogs } from "./dialogs.tsx";
import { holdingPlace } from "./holding-place.ts";
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
  /** The battery panel's stores and rows (battery/popover.tsx); without them the battery item opens nothing. */
  battery?: Omit<BatteryPopoverSources, "onApp" | "onAction" | "onSettings" | "chargeLimit">;
  /** System Settings at a pane ("network", "battery", "control-center"). */
  openSettingsPane?(pane: string): void;
}

export interface Menus {
  controller: MenuController;
  /** Control Center's stores and layout, as the panel has them (Settings › Control Center edits with them). */
  controlCenter: Omit<ControlCenterProps, "page" | "onPage" | "onClose" | "onBattery">;
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
  // A confirmed restart, shut down, or log out asks the apps to close first (closing-apps.ts).
  const dialogs = new Dialogs(
    openOverlay,
    runPower,
    compositor
      ? {
          windows: async () =>
            (await compositor.windows())
              .filter((window) => window.pid !== process.pid)
              .map((window) => ({ id: window.id, name: appFor(options.apps, window, entryFor).name })),
          close: async (window) => {
            // The app quits with the session: a question it asks says so ("Quit Terminal?").
            const pid = (await compositor.windows().catch(() => [])).find((each) => each.id === window)?.pid ?? null;
            appMenus.quitting(ownerPids(pid));
            await compositor.request("close", { window });
          },
          // The log out was cancelled: the app's "Quit Terminal?" or its sheet goes with it.
          withdraw: (window) =>
            void compositor
              .windows()
              .then((windows) => appMenus.stay(ownerPids(windows.find((each) => each.id === window)?.pid ?? null)))
              .catch(() => {}),
          focus: (window) => void compositor.request("focus", { window }).catch(() => {}),
          place: async (window) => {
            const frame = (await compositor.windows()).find((each) => each.id === window)?.frame ?? null;
            return holdingPlace(frame, parseOutputs(await compositor.request("outputs")));
          },
        }
      : undefined,
  );
  // On a development run the radios' switches write to memory, never to the developer's machine.
  const radios = radiosFor({
    standIn: options.wifi.fake || options.bluetooth.fake,
    run: runCommand,
    wifi: options.wifi.radio,
    bluetooth: options.bluetooth.radio,
  });
  const devices = new DeviceStore({
    hotspotRadio: radios.hotspot,
    volumeChanged: (volume) => options.system.publish("volume", volume),
    ...(options.brightnessChanged ? { brightnessChanged: options.brightnessChanged } : {}),
    wifiRadio: radios.wifi,
    bluetoothRadio: radios.bluetooth,
    // The Bluetooth radio asks BlueZ itself (and falls back to bluetoothctl, which may be missing).
    hasBluetoothctl: true,
  });
  const wifi = options.wifiStore;
  // On a development run the output switch is remembered in memory, never made the default on the developer's machine.
  const audio = soundBackendFor({ standIn: options.wifi.fake, run: runCommand });
  const sound = new SoundStore(audio);
  // Sheets that take the keyboard for the app in front: the bar keeps that app meanwhile (bar-hold.ts).
  const passwords = new PasswordPrompt(holdingBar(openOverlay), wifi);
  const bluetooth = new BluetoothStore(options.bluetooth.backend);
  // BlueZ's pairing questions (compare a code, type a PIN) come to the store and show on a sheet.
  options.bluetooth.backend.setPairingHandler(bluetooth);
  const pairing = new PairingPrompt(holdingBar(openOverlay), bluetooth, () => controller.close());
  pairing.start();

  const desktopsNow = (): Pick<MenuContext, "desktops"> => {
    const desktops = options.desktops?.getSnapshot();
    return desktops
      ? { desktops: { labels: desktops.labels, current: desktops.current, ...(desktops.fullscreen ? { fullscreen: desktops.fullscreen } : {}) } }
      : {};
  };

  const context = async (appName: string): Promise<MenuContext> => {
    const windows = await (compositor?.windows() ?? Promise.resolve([])).catch(() => []);
    const focused = windows.find((window) => window.focused) ?? null;
    return {
      appName,
      windows,
      focused,
      canLaunch: focused !== null && entryFor(focused.appId) !== undefined,
      canOpenHelp: helpCommand() !== null,
      arrangement: focused ? (options.arranger?.arrangement(focused.id) ?? null) : null,
      ...desktopsNow(),
    };
  };

  const layout = options.layout ?? new LayoutStore(null);
  const chargeLimit = options.chargeLimit ?? (() => null);
  const controlCenter: Omit<ControlCenterProps, "page" | "onPage" | "onClose" | "onBattery"> = {
    flags: controlFlags(),
    devices,
    system: options.system,
    wifi,
    sound,
    bluetooth,
    ...(options.laptop ? { laptop: options.laptop } : {}),
    layout,
    ...(options.appletControls ? { applets: options.appletControls } : {}),
    chargeLimit,
    onSettings: (pane) => {
      controller.close();
      options.openSettingsPane?.(pane);
    },
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
  };
  const controller: MenuController = new MenuController({
    context,
    openSurface: (onClosed, output) =>
      openOverlay(
        { title: "Menu", width: 1, height: 1, surface: popoverSurface(output) },
        <PopoverRoot
          controller={controller}
          appMenus={appMenus}
          controlCenter={controlCenter}
          notifications={options.notifications}
          dockInset={(output) => options.dockInset?.(output) ?? 0}
          onChoose={(action, appName) => {
            lastAppName = appName;
            run(action);
          }}
          onDockChoose={options.runDock}
          onStatusChoose={(action) => (action.kind === "activity-monitor" ? void showEnergy(action.app) : options.runStatus(action))}
          onStatusClosed={(key) => options.statusClosed?.(key)}
          {...(options.agentsPanel ? { agentsPanel: options.agentsPanel } : {})}
          {...(options.overflowRow ? { overflowRow: options.overflowRow } : {})}
          {...(options.accessible ? { accessible: options.accessible } : {})}
          {...(options.battery
            ? {
                battery: {
                  ...options.battery,
                  chargeLimit,
                  onApp: (app) => void showEnergy(app),
                  onAction: (action) => (action.kind === "activity-monitor" ? void showEnergy(action.app) : options.runStatus(action)),
                  onSettings: () => options.runStatus({ kind: "battery-settings" }),
                },
              }
            : {})}
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
    openSearch: () => options.openSearch?.(),
    selectAppItem: (pid, id) => void appMenus.select(pid, id),
    appQuitting: (pid) => void appMenus.quitting(ownerPids(pid)),
    moveToSpace: (window, space) => options.desktops?.move(window, space) ?? Promise.resolve(),
  };

  // The battery menu's apps: Activity Monitor's Energy tab, with the app chosen selected.
  const showEnergy = (app?: EnergyApp): Promise<boolean> =>
    openActivityMonitor(energyArgs(app), {
      windows: () => compositor?.windows() ?? Promise.resolve([]),
      focus: (window) => compositor?.request("focus", { window }) ?? Promise.resolve(),
      handOver: (pid, args) => appMenus.open(ownerPids(pid), args),
      launch: (args) => {
        const entry = entryFor(ACTIVITY_MONITOR);
        return entry?.exec ? launchEntry({ ...entry, exec: [...entry.exec, ...args] }) !== null : false;
      },
    });

  // An app's window that took a second start's file (Preview's empty one) comes forward, as a new window would have.
  appMenus.onFront((pid) => {
    if (!compositor) return;
    void compositor
      .windows()
      .then((windows) => {
        const window = windows.find((each) => ownerPids(each.pid).includes(pid));
        return window ? compositor.request("focus", { window: window.id }) : undefined;
      })
      .catch(() => {});
  });

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
      arrangement: options.arranger?.arrangement(window.id) ?? null,
      ...desktopsNow(),
    };
    return windowMenus(ctx);
  };

  return {
    controller,
    controlCenter,
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
