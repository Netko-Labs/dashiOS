/**
 * dashi-shell: the menu bar and the Dock, each a Metal layer-shell surface
 * driven from this one process. The primary screen's menu bar host follows
 * every window (`shell.toplevels`), since it is always there; both UIs read
 * that store.
 *
 *   WAYLAND_DISPLAY=<dashi-comp socket> bun src/main.tsx
 */

import { homedir } from "node:os";
import { existsSync } from "node:fs";
import { activeScreen } from "./active-screen.ts";
import { createAgentUi } from "./agent-sheets.tsx";
import { Arranger } from "./arrange.ts";
import { AgentStore, startAgents } from "./agents/index.ts";
import { AppCatalog } from "./app-catalog.ts";
import { startAppMenus } from "./app-menus/index.ts";
import { Grants } from "./agents/consent.ts";
import { LockWatch } from "./agents/lock.ts";
import { ChromeStyle } from "./appearance/chrome.ts";
import { DEFAULT_CORNERS } from "./corners.ts";
import { SCROLL_SPEED_DEFAULT } from "./scroll-speed.ts";
import { loadRecents, recentEntries, rememberLaunch } from "./recents.ts";
import type { WallpaperChoice } from "./wallpaper/catalog.ts";
import { LiveWallpaperController } from "./wallpaper/live/controller.ts";
import { reportWallpaper, WallpaperSync } from "./wallpaper/sync.ts";
import { CornerFeed } from "./appearance/corner-feed.ts";
import { sessionDeps, startAppearance } from "./appearance/index.ts";
import { appFor, displayName, iconPath, launch, METAL_HOST, resolvePinned } from "./apps.ts";
import { startAutostart } from "./autostart.ts";
import { installDesktopEntries, shouldWriteEntries } from "./desktop-entries.ts";
import { installedSpecs, shellDir } from "./first-party.ts";
import { Compositor } from "./compositor.ts";
import { controlFlags } from "./control-center/index.ts";
import { connectDarkMode } from "./control-center/dark-mode.ts";
import { parseScreens, startDisplays } from "./displays.ts";
import { AnimationTargets, AttentionStore, bottomInset, DockController, DockPrefs, matchEntry, PinStore, resolveDock, startDock, TileStore } from "./dock/index.ts";
import { type Entry, fileIcon, launchEntry, loadEntries } from "./entries.ts";
import { iconNamesFor, searchFiles } from "./file-search.ts";
import { run } from "./system/exec.ts";
import { startForceQuit } from "./force-quit/index.ts";
import { startGestures } from "./gestures.ts";
import { type FileRow, LAUNCHER, Launcher } from "./launcher.tsx";
import { MenuBar } from "./menubar.tsx";
import { choosePrimary, MenuBars, pickPrimary } from "./menubars.ts";
import { DisplayManager, DisplayStore, keepSheet, parseMonitors, watchLid } from "./display-config/index.ts";
import { scaleForMonitor } from "./display-config/scale.ts";
import { startMenus } from "./menus/index.ts";
import { runPower } from "./menus/session.ts";
import { SHEET, ShortcutSheet } from "./sheet.tsx";
import { IdlePolicy } from "./idle.ts";
import { KEYMAP } from "./keymap.ts";
import { LockController } from "./lock/index.ts";
import type { Tile } from "./layout.ts";
import { startNightShift } from "./night-shift.ts";
import { startCalendar } from "./calendar/index.ts";
import { startNotifications } from "./notifications/index.ts";
import { idleOffReason, startPower } from "./power/index.ts";
import { openOverlay } from "./overlay.tsx";
import { OverlaySlots } from "./overlay-slots.ts";
import { OverviewController } from "./overview/index.ts";
import { SettingsStore, startSettingsApp } from "./settings-app/index.ts";
import { machineDesktop } from "./settings-app/machine-desktop.ts";
import { registerPaneEntries } from "./settings-app/search.ts";
import { createPaneServices, type PaneServices } from "./settings-app/services.ts";
import { ScreenCaptureStore, startScreenCapture } from "./screen-capture.ts";
import { startPolkit } from "./polkit/index.ts";
import { chooseRegion, startRegion } from "./region/index.ts";
import { regionDesktop } from "./region/desktop.ts";
import { startSetupAssistant } from "./setup/start.tsx";
import { AutoAppearance } from "./appearance/auto.ts";
import { type AreaCapture, areaCapture, chooseCaptureScreen } from "./screenshot-area.tsx";
import { takeScreenshot } from "./screenshots.ts";
import { startSettings } from "./settings.ts";
import { runClosers } from "./shutdown.ts";
import { FullscreenBars } from "./fullscreen.ts";
import { startShortcuts } from "./shortcuts.ts";
import { startSpaces } from "./spaces/index.ts";
import { BatteryAlerts } from "./system/battery-alerts.ts";
import { startSystem } from "./system/start.ts";
import { isDevelopmentRun } from "./system/stand-in.ts";
import { chooseBluetooth } from "./bluetooth/index.ts";
import { chooseWifi, WifiStore } from "./wifi/index.ts";
import {
  type SwitcherApp,
  SwitcherController,
  SwitcherPanel,
  type SwitcherState,
  SwitcherStore,
  switcherSize,
} from "./switcher.tsx";
import { MENU_BAR_HEIGHT } from "./theme.ts";
import { ToplevelStore } from "./toplevels.ts";

// One failing feature (a scan, a D-Bus call, a timer) must not take the menu
// bar and the Dock down with it: Bun exits on anything unhandled, so log it
// and keep going. The session restarts the shell only when it really dies.
// @dashi/ui paints by Control Center's Dark Mode; connected before anything renders.
connectDarkMode();
process.on("unhandledRejection", (reason) => console.error("dashi-shell: unhandled rejection:", reason));
process.on("uncaughtException", (error) => console.error("dashi-shell: uncaught exception:", error));

if (!existsSync(METAL_HOST)) {
  console.error(
    `dashi-shell: no Metal host at ${METAL_HOST}; build it (cargo build --release in mirin/crates/mirin-metal) or set DASHI_METAL_HOST`,
  );
  process.exit(1);
}

const apps = resolvePinned();

// The shell's logic runs here, in Bun; dashi-comp offers windows, captures,
// and key events over its IPC, and matches keys against our keymap.
const compositor = await Compositor.connect();
compositor?.request("keymap", KEYMAP).catch((error) => console.error("dashi-shell: dashi-comp refused the keymap:", error));

// A menu bar goes on every screen, the Dock on the primary one (menubars.ts).
// The screens, or null when the compositor could not say (nothing should be torn down on a failed question).
// The main display Settings chose is the compositor's `primary` (display-config/); the bars follow it.
let mainDisplay: string | null = null;
const screenNames = async (): Promise<string[] | null> => {
  if (!compositor) return [];
  try {
    const answer = await compositor.request("outputs");
    mainDisplay = parseMonitors(answer).find((monitor) => monitor.enabled && monitor.primary)?.name ?? null;
    return parseScreens(answer).map((screen) => screen.name);
  } catch {
    return null;
  }
};
const firstScreens = (await screenNames()) ?? [];
const primaryScreen = pickPrimary(firstScreens, mainDisplay) ?? undefined;

// The primary menu bar's host reports the windows (`shell.toplevels`); the store follows whichever host is up.
const toplevels = new ToplevelStore();

// settings.json, which System Settings writes (settings-app/store.ts); a scale
// chosen there wins over each screen's default, from its pixel density (displays.ts).
const settingsStore = new SettingsStore();
// The menu bar follows `menuBar` in the file, so a hand edit shows without Settings being open.
const stopWatchingSettings = settingsStore.watch();
// The Dock's settings (dock/prefs.ts): the file is the source of truth; they are applied from it at
// startup and after every change, and a change made here (⌥❖D, the Dock's menu) is written to it.
// The clocks and the time zone: timedated on a real session, a stand-in on a development run (region/select.ts).
const regionSetup = chooseRegion();
const region = startRegion({ settings: settingsStore, backend: regionSetup.backend });
const dockPrefs = new DockPrefs((change) => settingsStore.patch("dock", change));
settingsStore.subscribe(() => dockPrefs.apply(resolveDock(settingsStore.getSnapshot().data.dock)));
// Spaces: desktops side by side (spaces/). The count lives in settings.json; the
// compositor keeps each window's Space and slides them, the rest is decided here.
const spaces = compositor
  ? startSpaces({
      compositor,
      open: openOverlay,
      screen: () => whereIsPerson(),
      leaveOverview: (): Promise<void> => overview?.leave(0) ?? Promise.resolve(),
      saveCount: (count) => settingsStore.patch("spaces", { count }),
    })
  : null;
const stopDisplays = compositor
  ? startDisplays(
      compositor,
      (name) => settingsStore.displayScale(name),
      (name) => settingsStore.displayVrr(name),
    )
  : () => {};
// Where each screen sits, what it runs, and which is the main display: saved per set of connected
// monitors and restored when they are plugged in; the lid shut with a monitor attached turns the
// built-in panel off (display-config/). Resolution and rotation changes are asked about, and go
// back by themselves (the sheet is on the main display).
const displayLid = compositor ? await watchLid() : null;
const displays = compositor
  ? new DisplayManager({
      compositor,
      store: new DisplayStore(),
      scaleFor: scaleForMonitor((name) => settingsStore.displayScale(name)),
      lid: displayLid,
      ask: keepSheet(openOverlay, () => menuBars.primaryName ?? undefined),
    })
  : null;
const stopArrangements = displays?.start() ?? (() => {});
// ~/.config/dashi/settings.json: input devices and the layout go to dashi-comp;
// idle is ours (blank the screens when the user is away), except inside
// another desktop, whose idle clock keeps the real screen (power/nested.ts).
const idleOff = idleOffReason();
if (compositor && idleOff) console.error(`dashi-shell: idle: off (${idleOff}; DASHI_IDLE=1 turns it on)`);
const idle = compositor && !idleOff ? new IdlePolicy(compositor) : null;
// How the compositor draws window chrome: Dark Mode's title bars and the
// Appearance setting's corners, both over IPC `chrome` (appearance/chrome.ts).
const chromeStyle = compositor ? new ChromeStyle(compositor) : null;
// GTK apps round their own windows to the same radius (appearance/gtk-colors.ts).
const gtkCorners = new CornerFeed();
// The wallpaper behind the windows and the lock screen (IPC `wallpaper`; wallpaper/).
const wallpaper = compositor ? new WallpaperSync(compositor) : null;
const stopWallpaperEvents = compositor?.on((event) => event.event === "wallpaper" && reportWallpaper(event));
// Live wallpapers (the compositor's shaders and videos) pause by the system store, so their
// controller starts after it; until then a choice goes to the plain sync (wallpaper/live/).
let liveWallpaper: LiveWallpaperController | null = null;
let wallpaperChoice: WallpaperChoice | null = null;
const stopSettings = compositor
  ? startSettings(compositor, (settings) => {
      void idle?.blankAfter(settings.idle.blankAfterSeconds);
      void idle?.sleepAfter(settings.idle.sleepAfterSeconds);
      chromeStyle?.setCorners(settings.appearance.cornerRadius);
      gtkCorners.set(settings.appearance.cornerRadius);
      chromeStyle?.setReduceMotion(settings.appearance.reduceMotion);
      wallpaperChoice = settings.appearance.wallpaper;
      if (liveWallpaper) liveWallpaper.apply(wallpaperChoice);
      else wallpaper?.apply(wallpaperChoice);
      dockPrefs.apply(settings.dock);
      void spaces?.controller.apply(settings.spaces);
    })
  : () => {};

// Where windows open, tiles, drag zones, and zoom (layout.ts).
const arranger = compositor ? new Arranger(compositor) : null;
const stopArranging = arranger ? await arranger.start() : () => {};
const tile = (window: number, to: Tile) => arranger?.tile(window, to) ?? Promise.resolve();
// The menu bar comes down over a full-screen window at the top edge (fullscreen.ts).
const fullscreenBars = compositor ? new FullscreenBars(compositor, MENU_BAR_HEIGHT) : null;
if (arranger) arranger.afterFullscreen = () => void fullscreenBars?.sync();
const stopFullscreenBars = fullscreenBars?.start() ?? (() => {});

// Wi-Fi: NetworkManager on a real session, a stand-in on a development run
// (wifi/select.ts), so a nested shell never touches the host's network.
const wifi = chooseWifi();
// Whether this is a development run, for what is not Wi-Fi or Bluetooth: polkit, autostart (system/stand-in.ts).
const developmentRun = isDevelopmentRun(process.env);
// Bluetooth likewise: BlueZ on a real session, a stand-in on a development run (bluetooth/select.ts).
const bluetooth = chooseBluetooth();

// Mission Control (⌃↑): the layout is decided here, the compositor draws it.
const overview = compositor ? new OverviewController(compositor, spaces?.overviewExtras) : null;
const stopOverview = overview?.start() ?? (() => {});
// Three fingers up or down on a touchpad: Mission Control; sideways: Spaces (gestures.ts).
const stopGestures =
  compositor && overview
    ? startGestures(compositor, {
        overview: (open) => void (open ? overview.enter() : overview.leave()),
        ...(spaces ? { spaces: spaces.controller } : {}),
      })
    : () => {};

// Battery, network, and volume for the menu bar; the volume and brightness keys.
const system = startSystem(wifi.status ? { network: wifi.status, ...(wifi.monitor ? { monitor: wifi.monitor } : {}) } : {});
if (compositor && wallpaper) {
  const controller = new LiveWallpaperController({
    compositor,
    sync: wallpaper,
    battery: () => system.store.getSnapshot().battery,
  });
  liveWallpaper = controller;
  if (idle) idle.onBlanked = (blanked) => controller.screensBlanked(blanked);
  system.store.subscribe(() => controller.powerChanged());
  if (wallpaperChoice) controller.apply(wallpaperChoice);
  void controller.start().catch((error) => console.error("dashi-shell: live wallpapers did not start:", error));
}
// The Wi-Fi list and joins: the menu and Control Center read it, and so do agents.
const wifiStore = new WifiStore(wifi.backend, { networkChanged: () => void system.store.refresh("network") });

// The lock screen; a session left locked by an earlier shell gets it back.
const lockScreen = compositor ? new LockController(compositor) : null;
void lockScreen?.resume();

// Sleep, the lid, and the power key, through logind (power/): the screen locks
// before the machine sleeps, `loginctl lock-session` locks it, and the power
// key asks first. With no logind it logs once and the shell goes on.
const power = startPower({
  compositor,
  lock: lockScreen ? () => lockScreen.lock() : null,
  confirmShutdown: () => menus.confirmPower("shutdown"),
  fallbackSuspend: () => runPower("sleep"),
});
// "Put the computer to sleep after" (Settings, Battery & Power): the idle clock's second threshold.
if (idle) idle.onSleep = () => void power.suspend();

// Agents (MCP) run here too.
// Screen sharing: the compositor serves the portal's captures only to the
// programs on our list, and tells us while one is running (screen-capture.ts).
const screenCapture = new ScreenCaptureStore();
const stopScreenCapture = compositor ? startScreenCapture(compositor, screenCapture) : () => {};

// Privileged actions apps ask for (pkexec, mounting a disk, software installs)
// need a password sheet: polkit's authentication agent (polkit/). It stays off
// on a development run, which never registers on the machine's system bus.
const polkitLock = compositor ? new LockWatch(compositor) : null;
const polkit = startPolkit({
  developmentRun,
  lock: polkitLock ?? { isLocked: false, onChange: () => () => {} },
  open: openOverlay,
});

// Agents (MCP) run here too; they start below, once what they reach exists.
const agentStore = new AgentStore();
const agentUi = createAgentUi();

// Notifications: org.freedesktop.Notifications on the session bus, with banners
// at the top right. If the bus is missing or the name is taken, it logs and
// the shell goes on without.
const notifications = startNotifications(undefined, { screen: () => (compositor ? activeScreen(compositor) : Promise.resolve(undefined)) });
// Low-battery warnings go through that store (system/battery-alerts.ts).
const stopBatteryAlerts = new BatteryAlerts(notifications.store).start();
// Calendar's alerts fire from here, window open or not; the notification center's month marks the days with
// events and opens the app on one (calendar/). A development run keeps what has fired in memory, not in the state folder.
const calendar = startCalendar({ notifications: notifications.store, toplevels, ...(developmentRun ? { statePath: null } : {}) });
// Do Not Disturb is Control Center's switch; the store holds banners while it's on.
const flags = controlFlags();
const followFlags = () => notifications.store.setDoNotDisturb(flags.getSnapshot().dnd);
followFlags();
const stopFollowingFlags = flags.subscribe(followFlags);
// Night Shift warms the screens when its switch is on (night-shift.ts).
const stopNightShift = compositor ? startNightShift(compositor, flags) : () => {};
// Dark Mode repaints the shell by itself (theme.ts); apps are told here (appearance/).
const stopAppearance = startAppearance(flags, { ...sessionDeps(), corners: gtkCorners });
// The compositor's title bars follow Dark Mode too (IPC `chrome`).
const tellChrome = () => chromeStyle?.setDark(flags.getSnapshot().dark);
tellChrome();
const stopChrome = flags.subscribe(tellChrome);

// Force Quit Applications: from the Dashi menu and ⌥❖Esc (force-quit/).
const forceQuit = startForceQuit(compositor);

// The machine panes' stores (Network, Bluetooth, Sound, Battery & Power, Users & Accounts) are made when Settings or an
// agent first needs them, from the stores the menus run (menus/start.tsx).
let paneServices: PaneServices | undefined;
function paneServicesOf(): PaneServices {
  return (paneServices ??= createPaneServices({ shared: menus.shared, system: system.store }));
}

// Agents reach the same stores and controllers the menus use (agents/desktop/).
const agents = compositor
  ? startAgents({
      compositor,
      ui: agentUi,
      store: agentStore,
      tile,
      desktop: {
        notifications: notifications.store,
        flags,
        dock: dockPrefs,
        wifi: wifiStore,
        forceQuit,
        rememberScale: (name, scale) => settingsStore.setDisplayScale(name, scale),
        ...(displays ? { displays } : {}),
        corners: {
          get: () => settingsStore.getSnapshot().data.appearance.cornerRadius ?? DEFAULT_CORNERS,
          set: (name) => settingsStore.patch("appearance", { cornerRadius: name }),
        },
        scrollSpeed: {
          get: (device) => settingsStore.getSnapshot().data[device === "trackpad" ? "touchpad" : "mouse"].scrollSpeed ?? SCROLL_SPEED_DEFAULT,
          // 1 is no setting, as the panes' slider middle is.
          set: (device, factor) => settingsStore.patch(device === "trackpad" ? "touchpad" : "mouse", { scrollSpeed: factor === SCROLL_SPEED_DEFAULT ? undefined : factor }),
        },
        lock: () => lockScreen?.lock(),
        region: regionDesktop(region.store, settingsStore),
        menuBar: {
          get: () => {
            const { menuBar } = settingsStore.getSnapshot().data;
            return { batteryPercent: menuBar.batteryPercent ?? false, sound: menuBar.sound ?? true };
          },
          set: (change) => settingsStore.patch("menuBar", change),
        },
        machine: machineDesktop(paneServicesOf, settingsStore),
        // Late-bound: the Setup Assistant is made after the agents, and an agent can only call it once connected.
        setup: { open: (page) => setupAssistant?.open(page) },
        // Late-bound like the Setup Assistant: the menu bar's menus, apps' own included.
        menus: { of: (window) => menus.menusOf(window), run: (action, appName) => menus.run(action, appName) },
      },
    })
  : null;

// System Settings: from the Dashi menu, ❖, and the launcher (settings-app/). It
// registers itself as a shell app, so it comes before the catalogs below.
const settingsApp = startSettingsApp({
  compositor,
  displays,
  settings: settingsStore,
  region: region.store,
  openSetup: () => setupAssistant?.open(),
  flags,
  // The kept agent answers the sessions use; a fresh read of the file with no agents.
  grants: agents?.grants ?? new Grants(),
  lock: () => lockScreen?.lock(),
  services: paneServicesOf,
});

// The Setup Assistant: at a person's first login, and from Settings > About and the launcher (setup/).
// The launcher finds each Settings pane ("display" opens Displays).
registerPaneEntries((pane) => settingsApp.open(pane));
const setupAssistant = startSetupAssistant({ compositor, settings: settingsStore, region: region.store, flags, wifi: wifiStore, system: system.store });
// Auto appearance: Dark Mode by the time of day, when appearance.auto is on (appearance/auto.ts).
const autoAppearance = new AutoAppearance({ flags, enabled: () => settingsStore.getSnapshot().data.appearance.auto === true });
const stopAutoAppearance = autoAppearance.start();
const stopFollowingAuto = settingsStore.subscribe(() => autoAppearance.tick());

// What the Dock keeps (dock/): the installed apps, and the pinned ones in
// $XDG_CONFIG_HOME/dashi/dock.json, starting with the defaults of apps.ts.
// Read again for a window whose app none of them matches (an app installed since login: app-catalog.ts).
const appCatalog = new AppCatalog();
const catalog = appCatalog.entries;
toplevels.onReport = (toplevel) => void appCatalog.notice(toplevel.appId);
/** The installed app a window's app id stands for, as the Dock matches it; every surface names apps through it. */
const installedApp = (appId: string): Entry | undefined => matchEntry(catalog, appId);
const pins = new PinStore({ defaults: apps.map((app) => app.id) });
const dock = new DockController({
  catalog,
  pins,
  toplevels,
  compositor,
  launch,
  prefs: dockPrefs,
  openDockSettings: () => settingsApp.open("desktop-dock"),
  onPress: () => void overview?.leave(),
});
// Apps whose windows asked for focus and were refused get a badge (dock/attention.ts).
const attention = compositor ? new AttentionStore({ compositor, catalog, toplevels }) : null;

// Apps' own menus (app-menus/): published on $XDG_RUNTIME_DIR/dashi-menus.sock, shown while their window is focused.
const appMenus = startAppMenus({
  compositor,
  active: () => toplevels.getSnapshot().find((window) => window.activated)?.id ?? null,
  subscribe: toplevels.subscribe,
});

// The menu bar's menus and Control Center (menus/, control-center/).
const menus = startMenus({
  appMenus: appMenus.store,
  apps,
  catalog,
  compositor,
  arranger,
  system: system.store,
  notifications: notifications.store,
  wifi,
  wifiStore,
  bluetooth,
  lock: () => lockScreen?.lock(),
  sleep: () => void power.suspend(),
  openForceQuit: () => forceQuit.open(),
  openSettings: () => settingsApp.open(),
  // Without a compositor the Dock cannot hear the pointer, so it never autohides (dock/presenter.ts).
  // The Dock is on the primary screen only.
  dockInset: (output) =>
    output === undefined || output === menuBars.primaryName
      ? bottomInset({ ...dockPrefs.snapshot, autohide: dockPrefs.snapshot.autohide && compositor !== null })
      : 0,
  runDock: (action) => dock.run(action).catch((error) => console.error(`dashi-shell: Dock “${action.kind}” failed:`, error)),
  showShortcuts: (appName) => {
    if (!overlays.has("sheet")) openSheet(true, appName);
  },
});

// A menu open on the revealed bar keeps it there (fullscreen.ts), and keeps the app's menus in the bar.
const stopHoldingBars = menus.controller.subscribe(() => {
  const open = menus.controller.getSnapshot().popover !== null;
  fullscreenBars?.hold(open);
  appMenus.hold(open);
});

// The Dock sits on the primary screen (dock/start.tsx: the Dock or the taskbar). Unplug that screen
// and the Dock is opened again on the one that takes over (the menu bars below decide which); a Dock
// surface dying with its screen still there ends the shell.
const dockTiles = new TileStore();
const dockRuntime = startDock({
  tiles: dockTiles,
  prefs: dockPrefs,
  apps,
  catalog,
  pins,
  toplevels,
  controller: dock,
  menus: menus.controller,
  attention,
  compositor,
  onLost: (output) => void primaryHostLost(output),
});
dockRuntime.place(primaryScreen);
// Windows minimize toward their Dock tiles: the compositor draws it, the Dock knows where the tiles are (dock/animation-targets.ts).
const stopAnimationTargets = compositor
  ? new AnimationTargets({
      compositor,
      catalog,
      tiles: dockTiles,
      placement: async () => {
        const screens = parseScreens(await compositor.request("outputs"));
        const home = menuBars.primaryName ?? primaryScreen;
        const screen = screens.find((candidate) => candidate.name === home) ?? screens.find((candidate) => candidate.name === choosePrimary(screens.map((s) => s.name)));
        return screen?.frame ? { screen: screen.frame, style: dockPrefs.snapshot.style } : null;
      },
    }).start()
  : () => {};

// The Dock's host died: if its screen is still there the shell ends (the
// session restarts it); if the screen just left, everything moves to another.
async function primaryHostLost(output: string | undefined): Promise<void> {
  const names = await screenNames();
  if (output === undefined || names === null || names.includes(output)) return quit();
  followScreens(names);
}

/** The screens changed: bars on each, and the primary (with the Dock) on one that is left. */
function followScreens(names: string[]): void {
  menuBars.sync(names, mainDisplay);
  const primary = menuBars.primaryName;
  if (primary !== null) dockRuntime.place(primary);
}

// One bar per screen, all of the same MenuBar. The primary's host dying with
// its screen still there ends the shell (below); a bar of a screen that was
// unplugged just goes, and if it was the primary the primary moves.
const menuBars = new MenuBars({
  open: (output, onClosed, primary) =>
    openOverlay(
      {
        title: "Menu bar",
        width: 1,
        height: MENU_BAR_HEIGHT,
        // The anchor bar is the one surface that is always up, so its host reports the windows.
        ...(primary ? { capabilities: ["shell.toplevels"] } : {}),
        surface: {
          layer: "top",
          anchor: ["top", "left", "right"],
          exclusiveZone: MENU_BAR_HEIGHT,
          namespace: "dashi.menubar",
          ...(output === undefined ? {} : { output }),
        },
      },
      <MenuBar
        apps={apps}
        toplevels={toplevels}
        agents={agentStore}
        capture={screenCapture}
        system={system.store}
        menus={menus.controller}
        appMenus={appMenus.store}
        settings={settingsStore}
        {...(output === undefined ? {} : { output })}
        onStopAgent={(id) => agents?.stop(id)}
        installed={installedApp}
      />,
      onClosed,
      primary ? (host) => toplevels.attach(host) : undefined,
    ),
  onPrimaryLost: () => quit(),
  onPrimaryChanged: (name) => dockRuntime.place(name),
  screens: screenNames,
});
menuBars.start(firstScreens, mainDisplay);
const stopFollowingScreens = compositor
  ? compositor.on((event) => {
      if (event.event === "outputs-changed") void screenNames().then((names) => names && followScreens(names));
    })
  : () => {};

type OverlayKind = "launcher" | "sheet" | "switcher";
const overlays = new OverlaySlots<OverlayKind>();
const closeOverlay = (kind: OverlayKind): void => overlays.close(kind);

/** The screen the person is on (pointer, else focused window): launcher, sheet, switcher, and banners open there. */
const whereIsPerson = (): Promise<string | undefined> => (compositor ? activeScreen(compositor) : Promise.resolve(undefined));
/** `{ output }` for a surface, or nothing for the compositor's choice. */
const onScreen = (output: string | undefined): { output?: string } => (output === undefined ? {} : { output });

function openLauncher(): void {
  const close = () => closeOverlay("launcher");
  const entries = loadEntries();
  void overlays.showOn("launcher", whereIsPerson, (onClosed, output) =>
    openOverlay(
      {
        title: "Launcher",
        width: LAUNCHER.width,
        height: LAUNCHER.height,
        surface: {
          layer: "overlay",
          anchor: ["top"],
          margin: { top: 120 },
          keyboard: "exclusive",
          namespace: "dashi.launcher",
          ...onScreen(output),
        },
      },
      <Launcher
        entries={entries}
        recent={recentEntries(entries, loadRecents())}
        onOpen={(entry) => {
          rememberLaunch(entry.id);
          launchEntry(entry);
          close();
        }}
        findFiles={findLauncherFiles}
        onOpenFile={(file) => {
          openFile(file.url);
          close();
        }}
        onClose={close}
      />,
      onClosed,
    ),
  );
}

/** Files for the launcher, each with its icon. */
async function findLauncherFiles(query: string): Promise<FileRow[]> {
  const hits = await searchFiles(query, run, homedir());
  return hits.map((hit) => ({ ...hit, icon: fileIcon(iconNamesFor(hit)) }));
}

/** Opens a file or folder in its default app, as Files would. */
function openFile(url: string): void {
  const opener = Bun.which("gio") ? ["gio", "open", url] : ["xdg-open", url];
  try {
    Bun.spawn(opener, { cwd: homedir(), stdin: "ignore", stdout: "ignore", stderr: "ignore", detached: true });
  } catch (error) {
    console.error("dashi-shell: could not open a file:", error);
  }
}

/** The shortcut sheet; `pinned` (from the Help menu) closes on a click or Esc instead of on releasing ❖. */
function openSheet(pinned = false, appName?: string): void {
  const active = toplevels.getSnapshot().find((window) => window.activated);
  void overlays.showOn("sheet", whereIsPerson, (onClosed, output) =>
    openOverlay(
      {
        title: "Shortcuts",
        width: SHEET.width + 40,
        height: SHEET.height + 40,
        surface: { layer: "overlay", keyboard: pinned ? "exclusive" : "none", namespace: "dashi.shortcuts", ...onScreen(output) },
      },
      <ShortcutSheet
        appName={appName ?? (active ? appFor(apps, active, installedApp).name : "Desktop")}
        published={appMenus.store.getSnapshot()}
        onClose={pinned ? () => closeOverlay("sheet") : undefined}
      />,
      onClosed,
    ),
  );
}

const switcher = new SwitcherStore();

/** A name and icon for a switcher entry: the installed app, else a stand-in. */
function identifier(): (app: SwitcherApp) => { name: string; icon: string } {
  const entries = loadEntries();
  return (app) => {
    const entry = matchEntry(entries, app.appId);
    return entry
      ? { name: entry.name, icon: entry.icon }
      : { name: displayName(app.appId, app.title), icon: iconPath("generic") };
  };
}

function showSwitcher(state: SwitcherState): void {
  switcher.set(state);
  if (overlays.has("switcher")) return;
  const { width, height } = switcherSize(state.apps.length);
  void overlays.showOn("switcher", whereIsPerson, (onClosed, output) =>
    openOverlay(
      { title: "Switcher", width, height, surface: { layer: "overlay", namespace: "dashi.switcher", ...onScreen(output) } },
      <SwitcherPanel store={switcher} identify={identifier()} />,
      onClosed,
    ),
  );
}

// Shortcuts (keymap.ts) and ❖ taps and holds, as the compositor reports them.
// ⇧❖4's selection overlay, made on first use.
let captureArea: AreaCapture | undefined;
let focusedAtCapture: number | null = null;
const stopShortcuts = compositor
  ? startShortcuts(compositor, {
      appShortcut: async (window, shortcut) => {
        const pid = (await compositor.windows()).find((each) => each.id === window)?.pid ?? null;
        return appMenus.store.shortcut(appMenus.ownersOf(pid), shortcut);
      },
      toggleLauncher: () => (overlays.has("launcher") ? closeOverlay("launcher") : openLauncher()),
      showSheet: () => {
        if (!overlays.has("sheet")) openSheet();
      },
      hideSheet: () => closeOverlay("sheet"),
      forceQuit: () => forceQuit.open(),
      settings: () => settingsApp.open(),
      toggleAutohide: () => dockPrefs.toggleAutohide(),
      overview: { toggle: () => overview?.toggle() },
      ...(spaces ? { spaces: spaces.controller } : {}),
      switcher: new SwitcherController(compositor, { show: showSwitcher, hide: () => closeOverlay("switcher") }),
      tile,
      fullscreen: (window) => arranger?.toggleFullscreen(window) ?? Promise.resolve(),
      hardware: system.hardware,
      lock: () => lockScreen?.lock(),
      powerKey: () => power.powerKey(),
      screenshotArea: (window) => {
        focusedAtCapture = window;
        captureArea ??= areaCapture({
          open: openOverlay,
          // The focused window's screen, else the primary: named for the surface, and its corner for the area.
          screen: async () => {
            const [answer, windows] = await Promise.all([compositor.request("outputs"), compositor.windows().catch(() => [])]);
            const focused = windows.find((window) => window.id === focusedAtCapture)?.frame ?? null;
            return chooseCaptureScreen(answer, { near: focused, prefer: choosePrimary(parseScreens(answer).map((screen) => screen.name)) });
          },
          captureArea: (rect) => takeScreenshot(compositor, { rect }),
          captureWindow: async () =>
            focusedAtCapture === null ? undefined : takeScreenshot(compositor, { window: focusedAtCapture }),
        });
        captureArea();
      },
    })
  : () => {};

// XDG autostart (autostart.ts), once per login session. Run a moment after the
// bars exist so what it starts opens below the menu bar.
const AUTOSTART_SETTLE_MS = 1000;
// The Setup Assistant opens by itself at the first login, a moment after the bars exist.
const setupTimer = setTimeout(() => {
  if (compositor) setupAssistant.openAtLogin();
}, AUTOSTART_SETTLE_MS + 500);
// Desktop entries for the first-party apps, so other launchers and `gio open` can start them (desktop-entries.ts).
// Only in the person's own session: a development run would write the developer's applications folder.
if (shouldWriteEntries(process.env, developmentRun)) {
  void installDesktopEntries(installedSpecs(), { bun: process.execPath, root: shellDir, host: METAL_HOST });
}
let autostart: ReturnType<typeof startAutostart> | null = null;
const autostartTimer = setTimeout(() => {
  autostart = startAutostart({ developmentRun });
}, AUTOSTART_SETTLE_MS);

// The screen locking takes down everything of ours that is up: the lock screen is
// the only thing that may be on screen then (Force Quit and the agents' sheets do
// the same, each in its own place).
const stopClosingOnLock = compositor
  ? compositor.on((event) => {
      if (event.event !== "lock" || !event.locked) return;
      menus.dismissAll();
      overlays.closeAll();
      captureArea?.close();
    })
  : () => {};

// One surface gone, or a signal, means the session is going away. Each closer
// runs on its own: one that throws must not leave the process alive with the
// rest still running, so exit comes last whatever happened.
let quitting = false;
const quit = () => {
  if (quitting) return;
  quitting = true;
  runClosers([
    ["autostart timer", () => clearTimeout(autostartTimer)],
    ["setup timer", () => clearTimeout(setupTimer)],
    ["setup assistant", () => setupAssistant.close()],
    ["auto appearance", () => (stopFollowingAuto(), stopAutoAppearance())],
    ["region", () => region.close()],
    ["autostart", () => autostart?.close()],
    ["lock watch", stopClosingOnLock],
    ["polkit", () => polkit.close()],
    ["polkit lock watch", () => polkitLock?.close()],
    ["shortcuts", stopShortcuts],
    ["screenshot selection", () => captureArea?.close()],
    ["displays", stopDisplays],
    ["overview", stopOverview],
    ["gestures", stopGestures],
    ["spaces", () => spaces?.close()],
    ["attention", () => attention?.close()],
    ["settings", stopSettings],
    ["settings file watch", stopWatchingSettings],
    ["wallpaper events", () => stopWallpaperEvents?.()],
    ["live wallpaper", () => liveWallpaper?.stop()],
    ["idle", () => idle?.stop()],
    ["arranging", stopArranging],
    ["full screen", () => (stopHoldingBars(), stopFullscreenBars())],
    ["system", () => system.close()],
    ["power", () => power.close()],
    ["agents", () => agents?.close()],
    ["agent sheets", () => agentUi.close()],
    ["flags", stopFollowingFlags],
    ["night shift", stopNightShift],
    ["screen sharing", stopScreenCapture],
    ["battery alerts", stopBatteryAlerts],
    ["calendar", () => calendar.close()],
    ["appearance", stopAppearance],
    ["chrome", stopChrome],
    ["notifications", () => notifications.close()],
    ["menus", () => menus.close()],
    ["app menus", () => appMenus.close()],
    ["dock animation targets", stopAnimationTargets],
    ["dock controller", () => dock.close()],
    ["force quit", () => forceQuit.close()],
    ["settings app", () => settingsApp.close()],
    ["settings services", () => paneServices?.close()],
    ["overlays", () => overlays.closeAll()],
    ["screens", stopFollowingScreens],
    ["display arrangement", () => {
      stopArrangements();
      displayLid?.close();
    }],
    ["menu bars", () => menuBars.close()],
    ["dock", () => dockRuntime.close()],
  ]);
  process.exit(0);
};
process.on("SIGTERM", quit);
process.on("SIGINT", quit);
