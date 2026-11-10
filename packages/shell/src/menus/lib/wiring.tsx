/** What the menus are wired to: Control Center's props, what choosing a row does, the popover's content, and the context the bar's menus are built from. */

import type { ReactElement } from "react";
import pkg from "../../../package.json" with { type: "json" };
import { type AppMenuStore, ownerPids } from "../../app-menus/index.ts";
import { appFor } from "../../apps.ts";
import type { CompositorWindow } from "../../compositor/index.ts";
import { controlFlags, LayoutStore } from "../../control-center/index.ts";
import { launchEntry } from "../../entries.ts";
import { iconPath } from "../../shared/apps/index.ts";
import { chooseNetwork } from "../../wifi/index.ts";
import type { MenuController } from "../controller.ts";
import { helpCommand, openHelp } from "../launch.ts";
import { windowMenus } from "../model.ts";
import type { ControlCenterStores, EntryFor, MenusOptions } from "../options.ts";
import type { MenuAction, MenuContext, PowerKind, WindowMenu } from "../types.ts";
import type { AboutTarget, ActionDeps } from "./actions.ts";
import type { EnergyApp } from "./activity-monitor.ts";
import type { Dialogs } from "./dialogs.tsx";
import { PopoverRoot } from "./popover.tsx";
import type { AboutInfo } from "./power-sheets.tsx";
import type { MenuStores } from "./stores.ts";

export const SETTLE_MS = 150;

export interface ActionWiring {
  options: MenusOptions;
  appMenus: AppMenuStore;
  entryFor: EntryFor;
  dialogs: Dialogs;
  /** The sheet names the app the menu was opened over, which no longer has the keyboard. */
  lastAppName(): string;
}

export function actionDeps({ options, appMenus, entryFor, dialogs, lastAppName }: ActionWiring): ActionDeps {
  const { compositor } = options;
  const confirmPower = (what: PowerKind): void => dialogs.confirm(what);
  return {
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
    openHelp,
    showShortcuts: () => options.showShortcuts(lastAppName()),
    openForceQuit: () => options.openForceQuit(),
    openSettings: () => options.openSettings?.(),
    openSearch: () => options.openSearch?.(),
    selectAppItem: (pid, id) => void appMenus.select(pid, id),
    appQuitting: (pid) => void appMenus.quitting(ownerPids(pid)),
    moveToSpace: (window, space) => options.desktops?.move(window, space) ?? Promise.resolve(),
  };
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

export function controlCenterProps(options: MenusOptions, stores: MenuStores, closeMenus: () => void, chargeLimit: () => number | null): ControlCenterStores {
  const { wifi, devices, sound, bluetooth, passwords } = stores;
  return {
    flags: controlFlags(),
    devices,
    system: options.system,
    wifi,
    sound,
    ...(options.mixer ? { mixer: options.mixer } : {}),
    bluetooth,
    ...(options.laptop ? { laptop: options.laptop } : {}),
    layout: options.layout ?? new LayoutStore(null),
    ...(options.appletControls ? { applets: options.appletControls } : {}),
    chargeLimit,
    ...(options.mirror ? { mirror: options.mirror } : {}),
    onSettings: (pane) => {
      closeMenus();
      options.openSettingsPane?.(pane);
    },
    onJoin: (network) =>
      void chooseNetwork(wifi, network, (secured) => {
        // The sheet takes the keyboard; the popover would only sit in its way.
        closeMenus();
        passwords.ask(secured);
      }),
    onLock: () => {
      closeMenus();
      setTimeout(options.lock, SETTLE_MS);
    },
  };
}

export interface PopoverWiring {
  options: MenusOptions;
  controller: MenuController;
  appMenus: AppMenuStore;
  controlCenter: ControlCenterStores;
  chargeLimit: () => number | null;
  /** A row of a bar menu was chosen over the app called `appName`. */
  onChoose(action: MenuAction, appName: string): void;
  /** Opens Activity Monitor's Energy tab, with the app chosen. */
  showEnergy(app?: EnergyApp): Promise<boolean>;
}

export function popoverElement({ options, controller, appMenus, controlCenter, chargeLimit, onChoose, showEnergy }: PopoverWiring): ReactElement {
  return (
    <PopoverRoot
      controller={controller}
      appMenus={appMenus}
      controlCenter={controlCenter}
      notifications={options.notifications}
      dockInset={(output) => options.dockInset?.(output) ?? 0}
      onChoose={onChoose}
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
    />
  );
}

export interface MenuContexts {
  /** The context for the menu opened over `appName`. */
  context(appName: string): Promise<MenuContext>;
  menusOf(window: CompositorWindow): Promise<WindowMenu[]>;
}

export function menuContexts(options: MenusOptions, appMenus: AppMenuStore, entryFor: EntryFor): MenuContexts {
  const { compositor } = options;
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
  return { context, menusOf };
}
