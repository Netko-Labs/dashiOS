/**
 * The apps (main.tsx): the installed catalog and the Dock's pins and
 * controller, what keeps the computer awake and dashi-portal's sheets, apps'
 * own menus, programs' items in the menu bar (applets, the tray), and the
 * screen sharing picker.
 */

import { AppCatalog } from "../app-catalog.ts";
import { type AppMenus, startAppMenus } from "../app-menus/index.ts";
import { AppletCommands } from "../applets/commands.ts";
import { AppletControls } from "../applets/controls.ts";
import { AppletPopovers } from "../applets/popovers.ts";
import { AppletPower } from "../applets/power.ts";
import { popoverScreen, startApplets } from "../applets/start.tsx";
import { appFor, launch } from "../apps.ts";
import { startBatteryMonitor } from "../battery/index.ts";
import type { Compositor, CompositorWindow } from "../compositor.ts";
import { LayoutStore } from "../control-center/index.ts";
import { AttentionStore, DockController, matchEntry, PinStore } from "../dock/index.ts";
import type { Entry } from "../entries.ts";
import { openTarget } from "../extensions/start.ts";
import { ExtrasStore } from "../extras/index.ts";
import { openFile } from "../file-manager.ts";
import { InhibitFlag, keepAwake } from "../inhibit/index.ts";
import { LAUNCHER, RankingMemory } from "../launcher/index.ts";
import type { Notifications } from "../notifications/index.ts";
import { openOverlay } from "../overlay.tsx";
import { PortalSheets, pinNextLauncher, startPortalHost } from "../portal-host/index.ts";
import { startSharePicker } from "../share-picker/index.ts";
import { type App, dockDefaults } from "../shared/apps/index.ts";
import { mayServeTray } from "../system/stand-in.ts";
import type { ToplevelStore } from "../toplevels.ts";
import { startTray } from "../tray/index.ts";
import type { Arranging, Desktops } from "./desktop.ts";
import type { Look } from "./look.ts";
import type { LateParts } from "./parts.ts";
import type { Late, Services } from "./services.ts";
import type { Screens, Stores } from "./session.ts";
import type { SettingsWindows } from "./settings.ts";
import type { Guards } from "./system.ts";

/** Chooses the item of `window`'s app menus that shows `shortcut`, for the person's ❖ chords and an agent's. */
export async function appShortcut(compositor: Compositor | null, appMenus: AppMenus, window: number, shortcut: string): Promise<boolean> {
  const pid = (await compositor?.windows())?.find((each) => each.id === window)?.pid ?? null;
  return appMenus.store.shortcut(appMenus.ownersOf(pid), shortcut);
}

/** Tells the app owning a window of `pid` that it quits, just before the window is asked to close (kit/close.ts). */
export function appQuitting(appMenus: AppMenus, pid: number | null): void {
  appMenus.store.quitting(appMenus.ownersOf(pid));
}

export interface Catalog {
  catalog: Entry[];
  appCatalog: AppCatalog;
  /** The installed app a window's app id stands for, as the Dock matches it; every surface names apps through it. */
  installedApp: (appId: string) => Entry | undefined;
  /** What the Dock calls a window's app, for Desktops named after their apps. */
  nameApp: (window: CompositorWindow) => string;
  pins: PinStore;
  /** The launcher's ranking history (launcher/ranking/): what is opened from the Dock and the switcher counts too. */
  rankingMemory: RankingMemory;
  dock: DockController;
}

interface CatalogNeeds {
  compositor: Compositor | null;
  apps: App[];
  stores: Stores;
  desktops: Desktops;
  settingsWindows: SettingsWindows;
  overview: { leave(): unknown } | null;
  services: Services;
  late: Late<LateParts>;
}

/**
 * What the Dock keeps (dock/): the installed apps, and the pinned ones in $XDG_CONFIG_HOME/dashi/dock.json,
 * starting with the defaults of apps.ts. Read again for a window whose app none of them matches (an app
 * installed since login: app-catalog.ts).
 */
export function startCatalog({ compositor, apps, stores, desktops, settingsWindows, overview, services, late }: CatalogNeeds): Catalog {
  const appCatalog = new AppCatalog();
  const catalog = appCatalog.entries;
  stores.toplevels.onReport = (toplevel) => void appCatalog.notice(toplevel.appId);
  const installedApp = (appId: string): Entry | undefined => matchEntry(catalog, appId);
  const nameApp = (window: CompositorWindow): string => appFor(apps, window, installedApp).name;
  late.set("installedApp", installedApp);
  late.set("nameApp", nameApp);
  void desktops.spaces?.controller.relabel();
  const pins = new PinStore({ defaults: dockDefaults(apps) });
  const rankingMemory = new RankingMemory();
  services.add("ranking history", () => rankingMemory.close());
  const dock = new DockController({
    catalog,
    pins,
    toplevels: stores.toplevels,
    compositor,
    launch,
    prefs: stores.dockPrefs,
    openDockSettings: () => settingsWindows.settingsApp.open("desktop-dock"),
    onPress: () => void overview?.leave(),
    opened: (appId) => rankingMemory.opened(appId),
    // Quit in an icon's menu asks as ❖Q does: "Quit Terminal?" (kit/close.ts).
    appQuitting: (pid) => appQuitting(late.get("appMenus"), pid),
  });
  services.add("dock controller", () => dock.close());
  return { catalog, appCatalog, installedApp, nameApp, pins, rankingMemory, dock };
}

export interface KeepingAwake {
  portalHost: ReturnType<typeof startPortalHost>;
  attention: AttentionStore | null;
}

interface AwakeNeeds {
  compositor: Compositor | null;
  look: Look;
  arranging: Arranging;
  guards: Guards;
  catalog: Catalog;
  toplevels: ToplevelStore;
  services: Services;
}

/**
 * What keeps the computer awake (inhibit/): the portal's Inhibit, through dashi-portal, and
 * org.freedesktop.ScreenSaver; idle neither blanks nor sleeps while an app holds it, and an app
 * that leaves the bus lets go. dashi-portal's dialogs hang from the windows that asked, as sheets
 * (portal-host/sheets.ts), and its "Add to Dock" pins the web app it installs.
 */
export function startKeepingAwake({ compositor, look, arranging, guards, catalog, toplevels, services }: AwakeNeeds): KeepingAwake {
  const { idle } = look;
  const { arranger } = arranging;
  const { polkitLock, lockScreen } = guards;
  const holds = keepAwake();
  idle?.holdWith({ screen: () => holds.blocks(InhibitFlag.idle), sleep: () => holds.blocks(InhibitFlag.suspend) });
  const stopFollowingHolds = holds.subscribe(() => idle?.holdsChanged());
  const portalSheets = compositor && arranger ? new PortalSheets(compositor, (window) => arranger.place(window)) : null;
  if (arranger && portalSheets) arranger.claim = (window) => portalSheets.claim(window);
  const portalHost = startPortalHost({
    store: holds,
    screenSaver: { locked: () => polkitLock?.isLocked ?? false, lock: () => void lockScreen?.lock(), idleSeconds: () => 0 },
    expectSheet: (title, parent) => portalSheets?.expect(title, parent) ?? false,
    addToDock: (appId) =>
      void pinNextLauncher(appId, (id) => {
        catalog.appCatalog.notice(id);
        catalog.pins.pin(id);
      }),
  });
  const stopTellingScreenSavers = polkitLock?.onChange((locked) => void portalHost.then((host) => host?.lockChanged(locked))) ?? (() => {});
  services.add("keep awake", () => {
    stopFollowingHolds();
    stopTellingScreenSavers();
    void portalHost.then((host) => host?.close());
  });
  // Apps whose windows asked for focus and were refused get a badge (dock/attention.ts).
  const attention = compositor ? new AttentionStore({ compositor, catalog: catalog.catalog, toplevels }) : null;
  services.add("attention", () => attention?.close());
  return { portalHost, attention };
}

export interface Programs {
  appMenus: AppMenus;
  extras: ExtrasStore;
  batteryMonitor: ReturnType<typeof startBatteryMonitor>;
  appletCommands: AppletCommands;
  appletPower: AppletPower;
  controlLayout: LayoutStore;
  appletControls: AppletControls;
  appletPopovers: AppletPopovers;
}

interface ProgramsNeeds {
  compositor: Compositor | null;
  apps: App[];
  catalog: Catalog;
  toplevels: ToplevelStore;
  screens: Screens;
  services: Services;
  late: Late<LateParts>;
}

/** Apps' own menus, programs' items in the menu bar (applets and their commands, power and controls), and the battery's history. */
export function startPrograms({ compositor, apps, catalog, toplevels, screens, services, late }: ProgramsNeeds): Programs {
  // Apps' own menus (app-menus/): published on $XDG_RUNTIME_DIR/dashi-menus.sock, shown while their window is focused.
  const appMenus = late.set(
    "appMenus",
    startAppMenus({ compositor, active: () => toplevels.getSnapshot().find((window) => window.activated)?.id ?? null, subscribe: toplevels.subscribe }),
  );
  services.add("app menus", () => appMenus.close());
  // Menu bar extras (extras/): programs' own items in the status area, from the applets socket
  // ($XDG_RUNTIME_DIR/dashi-applets.sock, applets/) and the tray over D-Bus (tray/).
  const extras = new ExtrasStore();
  // The battery over time, its draw, the apps using energy, and what to make of it (battery/): the battery's menu and Settings show it.
  const batteryMonitor = startBatteryMonitor({ compositor, apps, installed: catalog.installedApp, entries: () => catalog.catalog });
  late.set("batteryMonitor", batteryMonitor);
  services.add("battery monitor", () => batteryMonitor.stop());
  // Applets' commands in the launcher (applets/commands.ts): answered on their connections, listed in the registry (extensions/).
  const appletCommands = new AppletCommands({
    copy: (text) => late.get("launcherClipboard").writeText(text),
    open: (target) => openTarget(target, { openUrl: openFile, openLink: (url) => late.get("actions").openLink(url) }),
    launcherOrigin: async () => {
      const screen = await popoverScreen(compositor, (await screens.whereIsPerson()) ?? null, late.get("menuBars").primaryName);
      return screen ? { output: screen.name, x: Math.round((screen.width - LAUNCHER.width) / 2), y: screen.barHeight + LAUNCHER.top } : null;
    },
  });
  // Dashi's power mode for applets that ask for it (applets/power.ts): the mode store joins once the laptop starts.
  const appletPower = new AppletPower();
  // Applets: everyone's socket, and the installed ones in their sandboxes (applets/start.tsx).
  // Control Center's layout on this machine, and applets' controls in it (control-center/, applets/controls.ts).
  const controlLayout = new LayoutStore();
  const appletControls = new AppletControls({ layout: controlLayout.getSnapshot, subscribeLayout: controlLayout.subscribe });
  // One popover at a time: an applet's closes the shell's menus and another applet's, and a shell menu closes it (applets/popovers.ts).
  const appletPopovers = new AppletPopovers();
  const stopApplets = startApplets({
    compositor,
    extras,
    openOverlay,
    primary: () => late.get("menuBars").primaryName,
    commands: appletCommands,
    power: appletPower,
    controls: appletControls,
    popovers: appletPopovers,
  });
  services.add("applets", stopApplets);
  return { appMenus, extras, batteryMonitor, appletCommands, appletPower, controlLayout, appletControls, appletPopovers };
}

interface PickerNeeds {
  compositor: Compositor | null;
  screens: Screens;
  spaces: Desktops["spaces"];
  notifications: Notifications;
  extras: ExtrasStore;
  services: Services;
  late: Late<LateParts>;
}

/** Screen sharing's picker (xdg-desktop-portal-wlr runs dashi-share-picker, which asks here: share-picker/), and the tray. */
export function startPickerAndTray({ compositor, screens, spaces, notifications, extras, services, late }: PickerNeeds): void {
  const stopSharePicker = compositor
    ? startSharePicker({
        compositor,
        open: openOverlay,
        screen: () => screens.whereIsPerson(),
        currentSpace: () => spaces?.controller.getSnapshot().current ?? 0,
        appName: (window) => late.peek("nameApp")?.(window) ?? window.appId,
        notifications: notifications.store,
      })
    : () => {};
  services.add("share picker", stopSharePicker);
  const tray = mayServeTray(process.env) ? startTray(extras) : Promise.resolve(null);
  services.add("tray", () => void tray.then((running) => running?.close()));
}
