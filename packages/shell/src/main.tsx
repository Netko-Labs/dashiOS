/**
 * dashi-shell: the menu bar and the Dock, each a Metal layer-shell surface
 * driven from this one process. The primary screen's menu bar host follows
 * every window (`shell.toplevels`), since it is always there; both UIs read
 * that store.
 *
 *   WAYLAND_DISPLAY=<dashi-comp socket> bun src/main.tsx
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { systemClipboard } from "../apps/kit/clipboard.ts";
import { formatAddress } from "./actions/address.ts";
import { linksEntry, startActions } from "./actions/index.ts";
import { RadioSource } from "./actions/sources/radios.ts";
import { isSettingKey, settingState } from "./actions/sources/settings.ts";
import { activeScreen } from "./active-screen.ts";
import { createAgentUi } from "./agent-sheets.tsx";
import { modelKeys, vaultTokenSource } from "./agents/ask/keys.ts";
import { TurnWatch } from "./agents/ask/now.ts";
import { type Ask, startAsk } from "./agents/ask/service.ts";
import { Grants } from "./agents/consent.ts";
import { AgentStore, startAgents } from "./agents/index.ts";
import { LockWatch } from "./agents/lock.ts";
import { personAnswered } from "./agents/person.ts";
import { watchApprovals } from "./agents/secrets/approvals.ts";
import { startPasswords } from "./agents/secrets/passwords.ts";
import { isVaultWindow } from "./agents/secrets/vault-view.ts";
import { serveTokens, tokensSocketPath } from "./agents/tokens/index.ts";
import { AppCatalog } from "./app-catalog.ts";
import { startAppMenus } from "./app-menus/index.ts";
import type { PressedChord } from "./app-menus/shortcut.ts";
import { AutoAppearance } from "./appearance/auto.ts";
import { ChromeStyle } from "./appearance/chrome.ts";
import { CornerFeed } from "./appearance/corner-feed.ts";
import { sessionDeps, startAppearance } from "./appearance/index.ts";
import { WindowStyleSync } from "./appearance/window-style.ts";
import { AppletCommands } from "./applets/commands.ts";
import { popoverScreen, startApplets } from "./applets/start.tsx";
import { createApprovalUi } from "./approval-sheet.tsx";
import { appFor, displayName, dockDefaults, iconPath, launch, METAL_HOST, ownApp, resolvePinned } from "./apps.ts";
import { Arranger, parseOutputs } from "./arrange.ts";
import { startAutostart } from "./autostart.ts";
import { startBatteryMonitor } from "./battery/index.ts";
import { chooseBluetooth } from "./bluetooth/index.ts";
import { startCalendar } from "./calendar/index.ts";
import { type Clipboard, startClipboard } from "./clipboard/start.ts";
import { Compositor, type CompositorWindow, type Frame } from "./compositor.ts";
import { connectDarkMode } from "./control-center/dark-mode.ts";
import { controlFlags } from "./control-center/index.ts";
import { DEFAULT_CORNERS } from "./corners.ts";
import { installDesktopEntries, shouldWriteEntries } from "./desktop-entries.ts";
import { DisplayManager, DisplayStore, keepSheet, parseMonitors, watchLid } from "./display-config/index.ts";
import { scaleForMonitor } from "./display-config/scale.ts";
import { parseScreens, startDisplays } from "./displays.ts";
import {
  AnimationTargets,
  AttentionStore,
  bottomInset,
  DockController,
  DockPrefs,
  matchEntry,
  PinStore,
  resolveDock,
  startDock,
  TileStore,
} from "./dock/index.ts";
import { type Entry, fileIcon, launchEntry } from "./entries.ts";
import { openTarget, startExtensions } from "./extensions/start.ts";
import { ExtrasStore } from "./extras/index.ts";
import { serveFileManager } from "./file-manager.ts";
import { FileSearch, iconNamesFor } from "./file-search.ts";
import { installedSpecs, shellDir } from "./first-party.ts";
import { startForceQuit } from "./force-quit/index.ts";
import { FullscreenBars } from "./fullscreen.ts";
import { startGestures } from "./gestures.ts";
import { startLostCardWatch } from "./graphics/lost-start.ts";
import { IdlePolicy } from "./idle.ts";
import { InhibitFlag, keepAwake } from "./inhibit/index.ts";
import { InputMethodRunner } from "./input-method.ts";
import { withSwitcher } from "./keymap.ts";
import { currentKeymap, idleKeymap, setPersonRules } from "./keymap-state.ts";
import { startLaptop } from "./laptop/start.ts";
import { hostIsAccessible } from "./launcher/access.ts";
import { AppIndex } from "./launcher/app-index.ts";
import { BUDGET } from "./launcher/budget.ts";
import { LaunchFailures } from "./launcher/failures.ts";
import type { LauncherHost, Presented } from "./launcher/host.ts";
import { LauncherKeys, withLauncher } from "./launcher/keys.ts";
import { launcherOrigin, type PictureRect, picturesOnScreen } from "./launcher/pictures.ts";
import { LauncherPrefs } from "./launcher/prefs.ts";
import { languagesOf, messageLocales, RankingMemory } from "./launcher/ranking/index.ts";
import { LAUNCHER_MOTION, ResidentHost } from "./launcher/resident.tsx";
import { FILE_ROWS } from "./launcher/rows.ts";
import { shellLauncherHost } from "./launcher/shell-host.ts";
import { logTiming, markOpen, sinceOpen } from "./launcher/timing.ts";
import { TYPE_BINDING, TypeAhead, typedFrom, withTyping } from "./launcher/type-ahead.ts";
import { desktopWord, LauncherWorld } from "./launcher/world.ts";
import { LAUNCHER, Launcher, type LauncherFiles } from "./launcher.tsx";
import type { Arrange } from "./layout.ts";
import { findFiles, hasLocalSearch, LocalSearchEndpoint } from "./local-search.ts";
import { LockController } from "./lock/index.ts";
import { MenuBar } from "./menubar.tsx";
import { choosePrimary, MenuBars, pickPrimary } from "./menubars.ts";
import { startMenus } from "./menus/index.ts";
import { runPower } from "./menus/session.ts";
import { startNightShift } from "./night-shift.ts";
import { startNotifications } from "./notifications/index.ts";
import { type OpenOverlay, openOverlay } from "./overlay.tsx";
import { OverlaySlots } from "./overlay-slots.ts";
import { OverviewController } from "./overview/index.ts";
import { DEFAULT_POINTER_SIZE, PointerSync } from "./pointer.ts";
import { startPolkit } from "./polkit/index.ts";
import { PortalSheets, pinNextLauncher, startPortalHost } from "./portal-host/index.ts";
import { idleOffReason, startPower } from "./power/index.ts";
import { powerOffReason } from "./power/nested.ts";
import { RecentApps, recentEntries } from "./recents.ts";
import { startCapture } from "./recorder/start.ts";
import { regionDesktop } from "./region/desktop.ts";
import { chooseRegion, startRegion } from "./region/index.ts";
import { ScreenCaptureStore, startScreenCapture } from "./screen-capture.ts";
import { type AreaCapture, areaCapture, chooseCaptureScreen } from "./screenshot-area.tsx";
import { takeScreenshot } from "./screenshots.ts";
import { SCROLL_SPEED_DEFAULT } from "./scroll-speed.ts";
import { startSettings } from "./settings.ts";
import { SettingsStore, startSettingsApp } from "./settings-app/index.ts";
import { machineDesktop } from "./settings-app/machine-desktop.ts";
import { registerPaneEntries } from "./settings-app/search.ts";
import { createPaneServices, type PaneServices } from "./settings-app/services.ts";
import { startSetupAssistant } from "./setup/start.tsx";
import { startSharePicker } from "./share-picker/index.ts";
import { SHEET, ShortcutSheet } from "./sheet.tsx";
import { startShortcuts } from "./shortcuts.ts";
import { configureMachineEnd, runClosers } from "./shutdown.ts";
import { FullscreenDesktops, startSpaces } from "./spaces/index.ts";
import { centeredOn, type SwitcherApp, SwitcherController, SwitcherPanel, type SwitcherState, SwitcherStore } from "./switcher/index.ts";
import { BatteryAlerts } from "./system/battery-alerts.ts";
import { isDevelopmentRun, mayServeTray } from "./system/stand-in.ts";
import { startSystem } from "./system/start.ts";
import { TextSize } from "./text-size.ts";
import { MENU_BAR_HEIGHT } from "./theme.ts";
import { ToplevelStore } from "./toplevels.ts";
import { startTray } from "./tray/index.ts";
import type { WallpaperChoice } from "./wallpaper/catalog.ts";
import { LiveWallpaperController } from "./wallpaper/live/controller.ts";
import { reportWallpaper, WallpaperSync } from "./wallpaper/sync.ts";
import { chooseWifi, WifiStore } from "./wifi/index.ts";
import { DEFAULT_X11_SCALING, startXwaylandScaling, type XwaylandChoice, type XwaylandScaling } from "./xwayland-scale.ts";

// One failing feature (a scan, a D-Bus call, a timer) must not take the menu
// bar and the Dock down with it: Bun exits on anything unhandled, so log it
// and keep going. The session restarts the shell only when it really dies.
// @dashi/ui paints by Control Center's Dark Mode; connected before anything renders.
connectDarkMode();
process.on("unhandledRejection", (reason) => console.error("dashi-shell: unhandled rejection:", reason));
process.on("uncaughtException", (error) => console.error("dashi-shell: uncaught exception:", error));

if (!existsSync(METAL_HOST)) {
  console.error(`dashi-shell: no Metal host at ${METAL_HOST}; build it (cargo build --release in mirin/crates/mirin-metal) or set DASHI_METAL_HOST`);
  process.exit(1);
}

const apps = resolvePinned();

// The shell's logic runs here, in Bun; dashi-comp offers windows, captures,
// and key events over its IPC, and matches keys against our keymap.
const compositor = await Compositor.connect();
// A shell outlives nothing: without its compositor it ends, so it never
// reopens its surfaces on the next session's (which reuses the socket names).
compositor?.onClosed(() => {
  console.error("dashi-shell: dashi-comp went away; the shell ends with it");
  process.exit(1);
});
// Idle, the keymap also says what keys do from a ❖ tap on: they type into the launcher (launcher/type-ahead.ts).
compositor?.request("keymap", idleKeymap()).catch((error) => console.error("dashi-shell: dashi-comp refused the keymap:", error));
// The launcher fades in from a little smaller (launcher/resident.tsx); with Reduce Motion the compositor skips it.
compositor
  ?.request("layer-motion", { namespace: LAUNCHER_MOTION.namespace, ms: LAUNCHER_MOTION.openMs, scale: LAUNCHER_MOTION.fromScale })
  .catch((error) => console.error("dashi-shell: dashi-comp refused the launcher's motion:", error));

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
/** What the Dock calls a window's app; set once the app catalog is read (below), for Desktops named after their apps. */
let nameApp: ((window: CompositorWindow) => string) | null = null;
// Spaces: desktops side by side (spaces/). The count lives in settings.json; the
// compositor keeps each window's Space and slides them, the rest is decided here.
const spaces = compositor
  ? startSpaces({
      compositor,
      open: openOverlay,
      screen: () => whereIsPerson(),
      leaveOverview: (): Promise<void> => overview?.leave(0) ?? Promise.resolve(),
      saveCount: (count) => settingsStore.patch("spaces", { count }),
      saveNames: (names) => settingsStore.patch("spaces", { names: names.length > 0 ? names : undefined }),
      appName: (window) => nameApp?.(window) ?? window.appId,
    })
  : null;
// A full-screen window gets a Desktop of its own (spaces/fullscreen.ts; settings.json `spaces.fullscreenDesktop`).
const fullscreenDesktops =
  compositor && spaces ? new FullscreenDesktops({ compositor, desktops: spaces.controller, changed: () => void fullscreenBars?.sync() }) : null;
const stopFullscreenDesktops = fullscreenDesktops?.start() ?? (() => {});
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
// The depth between windows: shadows, the hairline, the optional ring (IPC `window-style`; appearance/window-style.ts).
const windowStyle = compositor ? new WindowStyleSync(compositor) : null;
// GTK apps round their own windows to the same radius (appearance/gtk-colors.ts).
const gtkCorners = new CornerFeed();
// The wallpaper behind the windows and the lock screen (IPC `wallpaper`; wallpaper/).
const wallpaper = compositor ? new WallpaperSync(compositor) : null;
const stopWallpaperEvents = compositor?.on((event) => event.event === "wallpaper" && reportWallpaper(event));
// Live wallpapers (the compositor's shaders and videos) pause by the system store, so their
// controller starts after it; until then a choice goes to the plain sync (wallpaper/live/).
let liveWallpaper: LiveWallpaperController | null = null;
let wallpaperChoice: WallpaperChoice | null = null;
/** Settings → Appearance → Reduce Motion, for what the shell itself animates (the Dock's entrance). */
let reduceMotion = false;
// What other apps read about Dark Mode, the font, and the pointer (appearance/, pointer.ts).
const appearanceDeps = sessionDeps();
// The pointer's size: the compositor's, GTK's, and X11's (pointer.ts).
const pointer = compositor ? new PointerSync({ compositor, gate: appearanceDeps.gate, has: appearanceDeps.has, run: appearanceDeps.run }) : null;
// Text size: the shell's surfaces (through @dashi/ui) and GTK's (text-size.ts).
const textSize = new TextSize(compositor ? { gate: appearanceDeps.gate, has: appearanceDeps.has, run: appearanceDeps.run } : null).connect();
// The input method the person picked, run as the shell's own child (input-method.ts); only in a real
// session, where the shell may change what apps read: a nested run would replace the host's.
const inputMethod =
  compositor && appearanceDeps.gate.on
    ? new InputMethodRunner({
        has: appearanceDeps.has,
        env: process.env,
        spawn: (command) => {
          const child = Bun.spawn([...command], { stdin: "ignore", stdout: "ignore", stderr: "inherit" });
          return { exited: child.exited, kill: () => child.kill() };
        },
      })
    : null;
// What X11 apps hear (xwayland-scale.ts): the settings say it, X11 scaling below follows.
let xwaylandChoice: XwaylandChoice = { scaling: DEFAULT_X11_SCALING, pointerSize: DEFAULT_POINTER_SIZE };
let xwaylandScaling: XwaylandScaling | null = null;
const stopSettings = compositor
  ? startSettings(compositor, (settings) => {
      reduceMotion = settings.appearance.reduceMotion;
      void pointer?.apply(settings.appearance.pointerSize);
      void textSize.apply(settings.appearance.textSize);
      inputMethod?.apply(settings.inputMethod.engine);
      const choice = { scaling: settings.appearance.x11Apps, pointerSize: settings.appearance.pointerSize };
      if (choice.scaling !== xwaylandChoice.scaling || choice.pointerSize !== xwaylandChoice.pointerSize) {
        xwaylandChoice = choice;
        xwaylandScaling?.refresh();
      }
      void idle?.blankAfter(settings.idle.blankAfterSeconds);
      void idle?.sleepAfter(settings.idle.sleepAfterSeconds);
      chromeStyle?.setCorners(settings.appearance.cornerRadius);
      gtkCorners.set(settings.appearance.cornerRadius);
      chromeStyle?.setReduceMotion(settings.appearance.reduceMotion);
      windowStyle?.set({ highlight: settings.appearance.highlightActiveWindow, reduceMotion: settings.appearance.reduceMotion });
      wallpaperChoice = settings.appearance.wallpaper;
      if (liveWallpaper) liveWallpaper.apply(wallpaperChoice);
      else wallpaper?.apply(wallpaperChoice);
      dockPrefs.apply(settings.dock);
      if (fullscreenDesktops) fullscreenDesktops.enabled = settings.spaces.fullscreenDesktop;
      void spaces?.controller.apply(settings.spaces);
    })
  : () => {};

// Where windows open, tiles, Fill, drag zones, and the square (arrange.ts, layout.ts).
const arranger = compositor ? new Arranger(compositor) : null;
const stopArranging = arranger ? await arranger.start() : () => {};
const tile = (window: number, to: Arrange) => arranger?.arrange(window, to) ?? Promise.resolve();
const arrangement = (window: number) => arranger?.arrangement(window) ?? null;
// The menu bar comes down over a full-screen window at the top edge (fullscreen.ts).
const fullscreenBars = compositor ? new FullscreenBars(compositor, MENU_BAR_HEIGHT) : null;
if (arranger) arranger.afterFullscreen = () => void fullscreenBars?.sync();
if (arranger && fullscreenDesktops) arranger.desktops = fullscreenDesktops;
// The × on a full-screen Desktop in Mission Control takes its window out of full screen.
if (arranger && spaces) spaces.controller.leaveFullscreen = (window) => void arranger.fullscreen(window, false);
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
const system = startSystem({ compositor, ...(wifi.status ? { network: wifi.status, ...(wifi.monitor ? { monitor: wifi.monitor } : {}) } : {}) });
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
const capture = compositor ? startScreenCapture(compositor, screenCapture) : null;

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
// Passwords: Dashi's vault and the sources agents sign in from (agents/secrets/).
const passwords = startPasswords();
// Agents' API tokens stay home: dashi-agent asks here for its sandbox's token proxy (agents/tokens/).
const stopTokens = serveTokens({ path: tokensSocketPath(), tokens: passwords.vault.tokens });
// The vault's questions to the person (a passkey, a payment): fingerprint or password.
const approvalUi = createApprovalUi();
watchApprovals(approvalUi);
// A sheet's yes counts only if the person pressed it (agents/person.ts).
const agentUi = createAgentUi({ request: (method, params) => (compositor ? compositor.request(method, params) : Promise.reject(new Error("no compositor"))) });
// A "Your turn" is in the launcher's Now too while its banner is up (agents/ask/now.ts).
const turnWatch = new TurnWatch();
const showTurn = agentUi.turn;
agentUi.turn = (turn, signal) => turnWatch.track(turn, showTurn(turn, signal));
// The launcher's agents (agents/ask/): started once the action registry is, below.
let askAgents: Ask | null = null;

// Notifications: org.freedesktop.Notifications on the session bus, with banners
// at the top right. If the bus is missing or the name is taken, it logs and
// the shell goes on without.
// "Show in folder" from browsers and other apps (org.freedesktop.FileManager1): Dashi's Files answers.
const fileManager = serveFileManager((args, startup) => {
  const files = ownApp("dev.dashi.files");
  if (!files?.exec) return;
  launch({
    ...files,
    exec: [...files.exec, ...args],
    ...(startup !== "" ? { env: { ...files.env, XDG_ACTIVATION_TOKEN: startup, DESKTOP_STARTUP_ID: startup } } : {}),
  });
});
const notifications = startNotifications(undefined, { screen: () => (compositor ? activeScreen(compositor) : Promise.resolve(undefined)) });

// The screen recorder and ⇧❖5's toolbar (recorder/).
const screenOf = async (window: number | null) => {
  if (!compositor) return { origin: { x: 0, y: 0 } };
  const [answer, windows] = await Promise.all([compositor.request("outputs"), compositor.windows().catch(() => [])]);
  const near = windows.find((each) => each.id === window)?.frame ?? null;
  return chooseCaptureScreen(answer, { near, prefer: choosePrimary(parseScreens(answer).map((screen) => screen.name)) });
};
const captureTools = compositor
  ? startCapture({
      compositor,
      open: openOverlay,
      allow: (path) => capture?.allow(path) ?? (() => {}),
      notifications: notifications.store,
      screen: screenOf,
      captureArea: (window) => selectArea(window),
    })
  : null;

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
const stopAppearance = startAppearance(flags, { ...appearanceDeps, corners: gtkCorners });
// The compositor's title bars and the windows' depth follow Dark Mode too (IPC `chrome`, `window-style`).
const tellChrome = () => {
  const { dark } = flags.getSnapshot();
  chromeStyle?.setDark(dark);
  windowStyle?.set({ dark });
};
tellChrome();
const stopChrome = flags.subscribe(tellChrome);

// Force Quit Applications: from the Dashi menu and ⌥❖Esc (force-quit/).
const forceQuit = startForceQuit(compositor);

// The machine panes' stores (Network, Bluetooth, Sound, Battery & Power, Users & Accounts) are made when Settings or an
// agent first needs them, from the stores the menus run (menus/start.tsx).
let paneServices: PaneServices | undefined;
function paneServicesOf(): PaneServices {
  return (paneServices ??= createPaneServices({ shared: menus.shared, system: system.store, battery: batteryMonitor, laptop }));
}

// Clipboard history and snippets (clipboard/), started below once the registry and the launcher are.
let clipboard: Clipboard | null = null;
// Agents reach the same stores and controllers the menus use (agents/desktop/).
const agents = compositor
  ? startAgents({
      compositor,
      ui: agentUi,
      sources: passwords.sources,
      vault: passwords.vault,
      store: agentStore,
      tile,
      arrangement,
      desktop: {
        notifications: notifications.store,
        flags,
        dock: dockPrefs,
        wifi: wifiStore,
        forceQuit,
        rememberScale: (name, scale) => settingsStore.setDisplayScale(name, scale),
        ...(displays ? { displays } : {}),
        ...(spaces ? { spaces: spaces.controller } : {}),
        corners: {
          get: () => settingsStore.getSnapshot().data.appearance.cornerRadius ?? DEFAULT_CORNERS,
          set: (name) => settingsStore.patch("appearance", { cornerRadius: name }),
        },
        scrollSpeed: {
          get: (device) => settingsStore.getSnapshot().data[device === "trackpad" ? "touchpad" : "mouse"].scrollSpeed ?? SCROLL_SPEED_DEFAULT,
          // 1 is no setting, as the panes' slider middle is.
          set: (device, factor) =>
            settingsStore.patch(device === "trackpad" ? "touchpad" : "mouse", { scrollSpeed: factor === SCROLL_SPEED_DEFAULT ? undefined : factor }),
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
        // Late-bound too: ❖ chords an agent presses in Dashi's apps choose their menu items, as the person's do.
        appShortcut: (window, shortcut) => appShortcut(window, shortcut),
        ...(captureTools ? { recorder: captureTools.recorder } : {}),
        // Late-bound too: the clipboard history starts with the launcher's registry (clipboard/).
        clipboard: { recent: (limit) => clipboard?.recent(limit) ?? [] },
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
  passwords,
  clipboard: () => clipboard?.history ?? null,
  // Read when the window opens, after the catalog below is.
  installedApp: (id) => installedApp(id),
  openSetup: () => setupAssistant?.open(),
  flags,
  // The kept agent answers the sessions use; a fresh read of the file with no agents.
  grants: agents?.grants ?? new Grants(),
  answers: () => askAgents?.status ?? null,
  lock: () => lockScreen?.lock(),
  services: paneServicesOf,
});

// The Setup Assistant: at a person's first login, and from Settings > About and the launcher (setup/).
// The launcher finds each Settings pane ("display" opens Displays).
registerPaneEntries((pane) => settingsApp.open(pane));
const setupAssistant = startSetupAssistant({
  compositor,
  settings: settingsStore,
  region: region.store,
  flags,
  wifi: wifiStore,
  system: system.store,
  // Its last page teaches ❖ (setup/pages/done.tsx): Try it opens the launcher.
  openLauncher: () => showLauncher(),
  // Its Agents page lists the harnesses installed (agents/ask/choices.ts).
  answers: () => askAgents?.status ?? null,
});
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
nameApp = (window) => appFor(apps, window, installedApp).name;
void spaces?.controller.relabel();
const pins = new PinStore({ defaults: dockDefaults(apps) });
// The launcher's ranking history (launcher/ranking/): what is opened from the Dock and the switcher counts too.
const rankingMemory = new RankingMemory();
const dock = new DockController({
  catalog,
  pins,
  toplevels,
  compositor,
  launch,
  prefs: dockPrefs,
  openDockSettings: () => settingsApp.open("desktop-dock"),
  onPress: () => void overview?.leave(),
  opened: (appId) => rankingMemory.opened(appId),
});
// What keeps the computer awake (inhibit/): the portal's Inhibit, through dashi-portal, and
// org.freedesktop.ScreenSaver; idle neither blanks nor sleeps while an app holds it, and an app
// that leaves the bus lets go. dashi-portal's dialogs hang from the windows that asked, as sheets
// (portal-host/sheets.ts), and its "Add to Dock" pins the web app it installs.
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
      appCatalog.notice(id);
      pins.pin(id);
    }),
});
const stopTellingScreenSavers = polkitLock?.onChange((locked) => void portalHost.then((host) => host?.lockChanged(locked))) ?? (() => {});
// Apps whose windows asked for focus and were refused get a badge (dock/attention.ts).
const attention = compositor ? new AttentionStore({ compositor, catalog, toplevels }) : null;

// Apps' own menus (app-menus/): published on $XDG_RUNTIME_DIR/dashi-menus.sock, shown while their window is focused.
const appMenus = startAppMenus({
  compositor,
  active: () => toplevels.getSnapshot().find((window) => window.activated)?.id ?? null,
  subscribe: toplevels.subscribe,
});

// Menu bar extras (extras/): programs' own items in the status area, from the applets socket
// ($XDG_RUNTIME_DIR/dashi-applets.sock, applets/) and the tray over D-Bus (tray/).
const extras = new ExtrasStore();
// The battery over time, its draw, the apps using energy, and what to make of it (battery/): the battery's menu and Settings show it.
const batteryMonitor = startBatteryMonitor({ compositor, apps, installed: installedApp });
// Applets' commands in the launcher (applets/commands.ts): answered on their connections, listed in the registry (extensions/).
const appletCommands = new AppletCommands({
  copy: (text) => launcherClipboard.writeText(text),
  open: (target) => openTarget(target, { openUrl: openFile, openLink: (url) => actions.openLink(url) }),
  launcherOrigin: async () => {
    const screen = await popoverScreen(compositor, (await whereIsPerson()) ?? null, menuBars.primaryName);
    return screen ? { output: screen.name, x: Math.round((screen.width - LAUNCHER.width) / 2), y: screen.barHeight + LAUNCHER.top } : null;
  },
});
// Applets: everyone's socket, and the installed ones in their sandboxes (applets/start.tsx).
const stopApplets = startApplets({ compositor, extras, openOverlay, primary: () => menuBars.primaryName, commands: appletCommands });
// Screen sharing's picker: xdg-desktop-portal-wlr runs dashi-share-picker, which asks here (share-picker/).
const stopSharePicker = compositor
  ? startSharePicker({
      compositor,
      open: openOverlay,
      screen: () => whereIsPerson(),
      currentSpace: () => spaces?.controller.getSnapshot().current ?? 0,
      appName: (window) => nameApp?.(window) ?? window.appId,
      notifications: notifications.store,
    })
  : () => {};
const tray = mayServeTray(process.env) ? startTray(extras) : Promise.resolve(null);

// The graphics card falling off the bus is said once, and apps stop being offloaded to it (graphics/).
const lostCard = startLostCardWatch({ notifications: notifications.store, restart: () => menus.confirmPower("restart") });
// The laptop: power modes in sync with the firmware, battery health, its keys, saved tuning, the graphics card (laptop/).
const laptop = startLaptop({
  compositor,
  settings: settingsStore,
  system,
  notifications: notifications.store,
  developmentRun,
  realSession: powerOffReason() === null,
  lostCard,
  nameOf: (window) => appFor(apps, window, installedApp).name,
  openSettings: (pane) => settingsApp.open(pane),
  confirmRestart: () => menus.confirmPower("restart"),
});

// The menu bar's menus and Control Center (menus/, control-center/).
const menus = startMenus({
  appMenus: appMenus.store,
  apps,
  catalog,
  compositor,
  arranger,
  ...(spaces ? { desktops: spaces.controller } : {}),
  system: system.store,
  brightnessChanged: system.brightnessChanged,
  notifications: notifications.store,
  wifi,
  wifiStore,
  bluetooth,
  lock: () => lockScreen?.lock(),
  sleep: () => void power.suspend(),
  openForceQuit: () => forceQuit.open(),
  openSettings: () => settingsApp.open(),
  // Search… in the Dashi menu (launcher.tsx, below).
  openSearch: () => showLauncher(),
  // Without a compositor the Dock cannot hear the pointer, so it never autohides (dock/presenter.ts).
  // The Dock is on the primary screen only.
  dockInset: (output) =>
    output === undefined || output === menuBars.primaryName
      ? bottomInset({ ...dockPrefs.snapshot, autohide: dockPrefs.snapshot.autohide && compositor !== null })
      : 0,
  runDock: (action) => dock.run(action).catch((error) => console.error(`dashi-shell: Dock “${action.kind}” failed:`, error)),
  runStatus: (action) =>
    action.kind === "extra"
      ? extras.choose(action.key, action.id)
      : action.kind === "laptop"
        ? laptop.run(action.action)
        : action.kind === "allow-sleep"
          ? keepAwake().ignoreAll()
          : settingsApp.open("battery"),
  laptop,
  statusClosed: (key) => extras.menuClosed(key),
  showShortcuts: (appName) => {
    if (!overlays.has("sheet")) openSheet(true, appName);
  },
});

// Restart and Shut Down give the apps 10 s, then go regardless of what is stuck (shutdown.ts).
configureMachineEnd({
  processes: async () => {
    const windows = compositor ? await compositor.windows() : [];
    const byPid = new Map(
      windows.flatMap((window) => (window.pid === null || window.pid === process.pid ? [] : [[window.pid, appFor(apps, window, installedApp).name] as const])),
    );
    return [...byPid].map(([pid, name]) => ({ pid, name }));
  },
  waiting: (names, seconds, what) =>
    notifications.store.notify({
      appName: "Dashi",
      appIcon: "",
      summary: what === "restart" ? "Restarting" : "Shutting Down",
      body: `${names.join(", ")} ${names.length === 1 ? "isn’t" : "aren’t"} closing. Dashi will ${what === "restart" ? "restart" : "shut down"} without ${names.length === 1 ? "it" : "them"} in ${seconds} s.`,
      actions: [],
      urgency: "critical",
      expireTimeout: 0,
      imagePath: "",
      desktopEntry: "",
      category: "system",
      transient: true,
      resident: false,
    }),
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
  reduceMotion: () => reduceMotion,
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
        const screen =
          screens.find((candidate) => candidate.name === home) ?? screens.find((candidate) => candidate.name === choosePrimary(screens.map((s) => s.name)));
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
        {...(captureTools ? { recorder: captureTools.recorder } : {})}
        system={system.store}
        menus={menus.controller}
        appMenus={appMenus.store}
        extras={extras}
        batteryMonitor={batteryMonitor}
        laptop={laptop}
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
// X11 apps drawn at the screens' scale, not stretched (xwayland-scale.ts).
xwaylandScaling = compositor ? startXwaylandScaling({ compositor, choice: () => xwaylandChoice }) : null;
const stopXwaylandScaling = () => xwaylandScaling?.stop();

type OverlayKind = "launcher" | "sheet" | "switcher";
const overlays = new OverlaySlots<OverlayKind>();
const closeOverlay = (kind: OverlayKind): void => overlays.close(kind);

/** The screen the person is on (pointer, else focused window): launcher, sheet, switcher, and banners open there. */
const whereIsPerson = (): Promise<string | undefined> => (compositor ? activeScreen(compositor) : Promise.resolve(undefined));
/** `{ output }` for a surface, or nothing for the compositor's choice. */
const onScreen = (output: string | undefined): { output?: string } => (output === undefined ? {} : { output });

// The launcher (launcher.tsx). Nothing on a ❖ tap touches the disk: the apps are an index built
// once and kept fresh by inotify (launcher/app-index.ts), the history is held in memory
// (recents.ts), icons were resolved when the index was built, and file search knows
// whether it can look (file-search.ts).
const appIndex = new AppIndex();
const stopAppIndex = appIndex.start();
const launcherRecents = new RecentApps();
// Read now, at startup, so the first tap doesn't.
launcherRecents.list();
// Files over one LocalSearch D-Bus connection, ranked by name then recency (local-search.ts).
const localSearch = new LocalSearchEndpoint();
const fileSearch = new FileSearch({ ask: (query, limit) => findFiles(localSearch.ask, query, homedir(), limit), installed: hasLocalSearch() });
const launcherFiles: LauncherFiles = {
  isAvailable: () => fileSearch.isAvailable(),
  // More than the slots hold, best first: the rows keep the names that read as names (row-model.ts `fileNameMatches`).
  find: async (query) => (await fileSearch.find(query, FILE_ROWS * 4))?.map((hit) => ({ ...hit, icon: fileIcon(iconNamesFor(hit)) })) ?? null,
};
const launcherKeys = new LauncherKeys();
// Copying an answer: wl-copy, a child of the shell, so the compositor serves it data-control.
const launcherClipboard = systemClipboard();
const launchFailures = new LaunchFailures(notifications.store);
/**
 * The launcher's own keys come and go with it (launcher/keys.ts), as the switcher's do; every ❖ chord
 * is its own while Set shortcut… records. From the tap until its field has the keyboard every plain
 * key is typed ahead (launcher/type-ahead.ts): the compositor switches to those rules itself at the
 * tap, and `typing` says so for an open without one (Search…); `begin` hands the keys to the field
 * once its surface has drawn.
 */
/** Whether the open launcher's field has the keyboard yet (it waits for what was typed ahead). */
let handedOff = false;
let handoff: ReturnType<typeof setTimeout> | null = null;
const launcherKeymap = {
  typing: () => void compositor?.request("keymap", withTyping(currentKeymap())).catch((error) => console.error("dashi-shell: the launcher's keys:", error)),
  begin: () =>
    void compositor
      ?.request("keymap", withLauncher(currentKeymap(), launcherKeys.recording, launcherKeys.arrowsWanted))
      .catch((error) => console.error("dashi-shell: the launcher's keys:", error)),
  end: () => void compositor?.request("keymap", idleKeymap()).catch((error) => console.error("dashi-shell: dashi-comp refused the keymap:", error)),
};
/** The open launcher's keys again (a key set, recording a shortcut): the field's, or still typing ahead. */
const launcherKeysAgain = () => (handedOff ? launcherKeymap.begin() : launcherKeymap.typing());
launcherKeys.onRecording = () => {
  if (overlays.has("launcher")) launcherKeysAgain();
};
// ← and → are the launcher's while a row's windows can show (launcher/pictures.ts); they wait for the field like every key.
launcherKeys.onArrows = () => {
  if (overlays.has("launcher") && handedOff) launcherKeymap.begin();
};
/** The screen the open launcher is on, for its windows' pictures. */
let launcherOutput: string | undefined;
let launcherPicturesShown = false;
let launcherPicturesQueue: Promise<void> = Promise.resolve();
/**
 * The open launcher's window pictures (launcher/pictures.ts), from its surface's pixels to the
 * screen's: layer-shell puts it centered across the usable area, LAUNCHER.top down. The first
 * pictures wait for the list to finish growing to make room for them. In order, one at a time.
 */
function launcherPictures(rects: PictureRect[]): void {
  if (!compositor) return;
  const wait = rects.length > 0 && !launcherPicturesShown ? (launcherHeightMs() ?? 0) : 0;
  launcherPicturesShown = rects.length > 0;
  launcherPicturesQueue = launcherPicturesQueue
    .then(async () => {
      if (wait > 0) await Bun.sleep(wait);
      if (rects.length === 0) return void (await compositor.request("window-thumbnails", { rects: [] }));
      const outputs = parseOutputs(await compositor.request("outputs"));
      const screen = outputs.find((each) => each.name === launcherOutput) ?? outputs[0];
      if (!screen) return;
      await compositor.request("window-thumbnails", { rects: picturesOnScreen(rects, launcherOrigin(screen.usable, LAUNCHER.width, LAUNCHER.top)) });
    })
    .catch((error) => console.error("dashi-shell: the launcher's window pictures:", error));
}
/** The Metal host publishes an accessibility tree (launcher/access.ts): the launcher's rows then say what they are. */
let launcherAccessible = false;
void hostIsAccessible(METAL_HOST).then((accessible) => {
  launcherAccessible = accessible;
});
// The person's aliases and keys (settings.json `launcher`; launcher/person-keys.ts): a key they set
// reaches the compositor at once, and an edit of the file by hand too.
const launcherPrefs = new LauncherPrefs(settingsStore);
let personKeys = "";
const followPersonKeys = () => {
  const rules = launcherPrefs.rules();
  const text = JSON.stringify(rules);
  if (text === personKeys) return;
  personKeys = text;
  setPersonRules(rules);
  if (overlays.has("launcher")) launcherKeysAgain();
  else if (!overlays.has("switcher"))
    void compositor?.request("keymap", idleKeymap()).catch((error) => console.error("dashi-shell: dashi-comp refused the keymap:", error));
};
followPersonKeys();
const stopFollowingPersonKeys = settingsStore.subscribe(followPersonKeys);
/** The person's languages, for Dashi's own words in the launcher (launcher/ranking/locale.ts). */
const launcherLanguages = languagesOf(messageLocales(process.env));
// Made once the action registry is (below): what the launcher lists besides the apps, and what its verbs reach.
let launcherWorld: LauncherWorld | null = null;
let launcherHost: LauncherHost | null = null;
const typeAhead = new TypeAhead();
/** Longer than this without word that the launcher drew, its field is given the keys anyway. */
const TYPE_AHEAD_LIMIT_MS = 3000;
/** How long the typed-ahead keys must be quiet and played in before the field takes the keyboard. */
const HANDOFF_MS = 60;
// The field takes the keyboard once what was typed ahead is in it, and no key came for a moment:
// a key typed while it was still playing them in would reach it first (launcher/type-ahead.ts).
typeAhead.onSettled(() => {
  if (handedOff) return;
  if (handoff) clearTimeout(handoff);
  handoff = setTimeout(() => {
    handoff = null;
    if (handedOff || !typeAhead.isSettled()) return;
    handedOff = true;
    launcherKeymap.begin();
  }, HANDOFF_MS);
});
/** The launcher's surface has drawn: what was typed ahead goes to it, and the keyboard follows once it is in. */
function launcherReady(): void {
  if (!typeAhead.isWaiting()) return;
  typeAhead.ready();
}
/** The open launcher's bindings: a key typed ahead (`launcher-type`), or one of its keys (launcher/keys.ts). */
function launcherBinding(name: string, chord?: PressedChord, text?: string): boolean {
  if (name !== TYPE_BINDING) return launcherKeys.binding(name, chord);
  typeIntoLauncher({ key: chord?.key ?? "", ...(text === undefined ? {} : { text }) });
  return true;
}
/** A key typed ahead, from the compositor's `launcher-type` binding. */
function typeIntoLauncher(typed: { key: string; text?: string } | undefined): void {
  const key = typed ? typedFrom(typed) : null;
  if (key) typeAhead.push(key);
}

/** Start `entry` from the launcher; false when it could not be started at all. One that quits at once is a notification. */
function launchFromLauncher(entry: Entry): boolean {
  const pid = launchEntry(entry, {
    failed: () => {
      launcherRecents.forget(entry.id);
      launchFailures.quit(entry.name, () => launchFromLauncher(entry));
    },
  });
  if (pid === null) return false;
  launcherRecents.remember(entry.id);
  return true;
}

/** Open a first-party app with a word for it to look for (`env`); false when it isn't installed. */
function openWith(appId: string, env: Record<string, string>): boolean {
  const entry = appIndex.entries().find((each) => each.id === appId);
  return entry ? launchEntry({ ...entry, env: { ...entry.env, ...env } }) !== null : false;
}

// The launcher's own host, kept for the session and shown and hidden (launcher/resident.tsx); with a
// host binary that can't, it opens on the warm host as other overlays do.
const residentLauncher = new ResidentHost(METAL_HOST, {
  onFrame: (ms) => {
    logTiming("open → first frame", sinceOpen() ?? ms, BUDGET.openMs, "resident host");
    launcherReady();
  },
});
/** The list's height follows its rows on Dashi's curve (120 ms), on a host that can and without Reduce Motion. */
const launcherHeightMs = (): number | undefined => (residentLauncher.isReady() && !reduceMotion ? LAUNCHER_MOTION.heightMs : undefined);
const openLauncherSurface: OpenOverlay = (options, element, onClosed) => {
  const resident = residentLauncher.open(options, element, onClosed);
  if (resident) return resident;
  const opened = sinceOpen();
  if (opened !== null) logTiming("open → surface asked", opened, BUDGET.openMs, "no resident host: first frame not reported");
  // An older host reports no first frame: its answer to a layout question says it is up.
  return openOverlay(options, element, onClosed, (host) => {
    host.onEvent((event) => {
      const kind: string = event.type;
      if (kind === "layout" || kind === "frame") launcherReady();
    });
    host.simulate({ kind: "layout" });
  });
};

/** The launcher, unless it is up already (Search… in the Dashi menu, Try it in the Setup Assistant). */
function showLauncher(): void {
  if (!overlays.has("launcher")) openLauncher();
}

/** The launcher in one of its scopes (⌥❖V: the clipboard history), over `window`; one already open gives way. */
function openLauncherIn(scope: string, window: number | null): void {
  if (overlays.has("launcher")) closeOverlay("launcher");
  openLauncher(null, scope, window);
}

function openLauncher(presented: Presented | null = null, scope: string | null = null, window: number | null = null): void {
  markOpen();
  // Where the clipboard's ↩ pastes: the window under the launcher.
  clipboard?.opening(window);
  // Keys typed from the tap on wait for the field (launcher/type-ahead.ts).
  typeAhead.begin();
  handedOff = false;
  launcherKeymap.typing();
  const limit = setTimeout(launcherReady, TYPE_AHEAD_LIMIT_MS);
  const close = () => closeOverlay("launcher");
  const entries = appIndex.entries();
  void launcherWorld?.refresh();
  let opened = false;
  const finished = () => {
    clearTimeout(limit);
    if (handoff) clearTimeout(handoff);
    handoff = null;
    typeAhead.end();
    launcherKeymap.end();
  };
  const showing = overlays.showOn("launcher", whereIsPerson, (onClosed, output) => {
    opened = true;
    launcherOutput = output;
    // Its keys come with the surface and go with it, however it closes.
    return openLauncherSurface(
      {
        title: "Launcher",
        width: LAUNCHER.width,
        height: LAUNCHER.height,
        surface: {
          layer: "overlay",
          anchor: ["top"],
          margin: { top: LAUNCHER.top },
          keyboard: "exclusive",
          namespace: "dashi.launcher",
          ...onScreen(output),
        },
      },
      <Launcher
        entries={entries}
        recent={recentEntries(entries, launcherRecents.list())}
        onOpen={(entry, stay) => {
          if (!launchFromLauncher(entry)) return false;
          if (!stay) close();
          return true;
        }}
        files={launcherFiles}
        onOpenFile={(file, stay) => {
          openFile(file.url);
          if (!stay) close();
        }}
        onSearchFiles={(query) => {
          if (openWith("dev.dashi.files", { DASHI_FILES_SEARCH: query })) close();
        }}
        onFindSoftware={(query) => {
          if (openWith("dev.dashi.software", { DASHI_SOFTWARE_SEARCH: query })) close();
        }}
        copy={(text) => launcherClipboard.writeText(text)}
        keys={launcherKeys}
        {...(launcherWorld ? { world: launcherWorld } : {})}
        prefs={launcherPrefs}
        ranking={rankingMemory}
        {...(launcherHost ? { host: launcherHost } : {})}
        presented={presented}
        {...(clipboard ? { scopes: clipboard.scopes } : {})}
        scope={scope}
        languages={launcherLanguages}
        typeAhead={typeAhead}
        {...(askAgents ? { agents: askAgents.launcher } : {})}
        extensions={extensions.session}
        {...(launcherHeightMs() ? { heightTransitionMs: launcherHeightMs() } : {})}
        onPictures={launcherPictures}
        accessible={launcherAccessible}
        onClose={close}
      />,
      () => {
        finished();
        onClosed();
      },
    );
  });
  // Closed before it had a screen (a second tap): its keys go back as they were.
  void showing.then(() => {
    if (!opened) finished();
  });
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
/** The switcher names apps as the Dock does: the shared catalog, hidden entries included (T3 Code's window matches its NoDisplay entry). */
function identifier(): (app: SwitcherApp) => { name: string; icon: string } {
  return (app) => {
    const entry = installedApp(app.appId);
    return entry ? { name: entry.name, icon: entry.icon } : { name: displayName(app.appId, app.title), icon: iconPath("generic") };
  };
}

/** Where the switcher's surface is on screen (global logical), once it is open: its window pictures go from there. */
let switcherOrigin: Promise<{ x: number; y: number } | null> = Promise.resolve(null);

function showSwitcher(state: SwitcherState): void {
  switcher.set(state);
  if (overlays.has("switcher")) return;
  const { width, height } = state.size;
  void overlays.showOn("switcher", whereIsPerson, (onClosed, output) => {
    // Layer-shell centers it in what the menu bar and the Dock leave free (switcher/layout.ts).
    switcherOrigin = (compositor?.request("outputs") ?? Promise.resolve(null))
      .then((answer) => {
        const outputs = parseOutputs(answer);
        const screen = outputs.find((each) => each.name === output) ?? outputs[0];
        return screen ? centeredOn(screen.usable, state.size) : null;
      })
      .catch(() => null);
    return openOverlay(
      { title: "Switcher", width, height, surface: { layer: "overlay", namespace: "dashi.switcher", ...onScreen(output) } },
      <SwitcherPanel
        store={switcher}
        identify={identifier()}
        onPoint={(app, window) => switcherController?.point(app, window)}
        onPick={(app, window) => switcherController?.pick(app, window)}
      />,
      onClosed,
    );
  });
}

/** The chosen app's windows as live pictures in the switcher (`window-thumbnails`); none clears them. */
function switcherPictures(rects: ReadonlyArray<{ window: number; rect: Frame }>): void {
  if (!compositor) return;
  void switcherOrigin
    .then((origin) => {
      const placed = origin ? rects.map(({ window, rect }) => ({ window, x: origin.x + rect.x, y: origin.y + rect.y, w: rect.width, h: rect.height })) : [];
      return compositor.request("window-thumbnails", { rects: placed });
    })
    .catch((error) => console.error("dashi-shell: the switcher's pictures:", error));
}

/** The switcher session's own keys come and go with it (keymap.ts `withSwitcher`). */
const switcherKeys = {
  begin: () => void compositor?.request("keymap", withSwitcher(currentKeymap())).catch((error) => console.error("dashi-shell: the switcher's keys:", error)),
  end: () => void compositor?.request("keymap", idleKeymap()).catch((error) => console.error("dashi-shell: dashi-comp refused the keymap:", error)),
};

const switcherController = compositor
  ? new SwitcherController(
      compositor,
      { show: showSwitcher, hide: () => closeOverlay("switcher"), pictures: switcherPictures },
      (group) => identifier()({ appId: group.appId, title: group.title, count: group.windows.length, away: false }).name,
      switcherKeys,
      (window) => rankingMemory.opened(installedApp(window.appId)?.id ?? window.appId),
    )
  : null;

/** Choose the item of `window`'s app menus that shows `shortcut`, for the person's ❖ chords and an agent's. */
async function appShortcut(window: number, shortcut: string): Promise<boolean> {
  const pid = (await compositor?.windows())?.find((each) => each.id === window)?.pid ?? null;
  return appMenus.store.shortcut(appMenus.ownersOf(pid), shortcut);
}

// Shortcuts (keymap.ts) and ❖ taps and holds, as the compositor reports them.
// ⇧❖4's selection overlay, made on first use.
let captureArea: AreaCapture | undefined;
let focusedAtCapture: number | null = null;
/** ⇧❖4, and Capture Area in ⇧❖5's toolbar: drag out an area of the screen holding `window`. */
function selectArea(window: number | null): void {
  if (!compositor) return;
  focusedAtCapture = window;
  captureArea ??= areaCapture({
    open: openOverlay,
    // The focused window's screen, else the primary: named for the surface, and its corner for the area.
    screen: () => screenOf(focusedAtCapture),
    captureArea: (rect) => takeScreenshot(compositor, { rect }),
    captureWindow: async () => (focusedAtCapture === null ? undefined : takeScreenshot(compositor, { window: focusedAtCapture })),
  });
  captureArea();
}
// The action registry (actions/, docs/actions.md): every command at a dashi:// address, read by the
// keymap's address bindings, dashi:// links (xdg-open, on $XDG_RUNTIME_DIR/dashi-links.sock), and agents' tools/list.
const actions = startActions({
  compositor,
  agents,
  confirmPerson: (question) => agentUi.confirmPerson(question),
  entries: () => catalog,
  launch: launchEntry,
  // A key or link that opens an app brings its window forward when it has one, as the Dock does.
  activate: async (entry) => {
    const windows = (await compositor?.windows().catch(() => [])) ?? [];
    const own = windows.filter((window) => installedApp(window.appId)?.id === entry.id);
    const target = own.find((window) => window.focused) ?? own.find((window) => window.state === "normal") ?? own[0];
    if (!target || !compositor) return false;
    await compositor.request("focus", { window: target.id });
    return true;
  },
  appMenus: appMenus.store,
  appName: (window) => nameApp?.(window) ?? window.appId,
  arrange: arranger ? { arrow: (window, arrow) => arranger.arrow(window, arrow), tile, fullscreen: (window) => arranger.toggleFullscreen(window) } : null,
  runMenu: (action) => menus.run(action, "Dashi"),
  openSettings: (pane, row) => settingsApp.open(pane, row),
  keymap: currentKeymap(),
});
// Wi-Fi and Bluetooth as settings with state, from Control Center's own store (actions/sources/radios.ts).
const radioSource = new RadioSource({
  wifi: () => menus.shared.devices.getSnapshot().wifi,
  bluetooth: () => menus.shared.devices.getSnapshot().bluetooth,
  network: () => {
    const network = system.store.getSnapshot().network;
    return network?.kind === "wifi" && network.ssid ? network.ssid : null;
  },
  setWifi: (on) => menus.shared.devices.setWifi(on),
  setBluetooth: (on) => menus.shared.devices.setBluetooth(on),
  subscribe: (listener) => {
    const offs = [menus.shared.devices.subscribe(listener), system.store.subscribe(listener)];
    return () => {
      for (const off of offs) off();
    };
  },
});
const stopRadioSource = actions.registry.add(radioSource);
// Clipboard history (⌥❖V) and snippets: copies from the compositor's data-control, kept by the privacy
// rules, in the launcher's scopes; nothing kept while the screen is shared, recorded, or locked (clipboard/).
clipboard = startClipboard({
  compositor,
  settings: settingsStore,
  paused: () => screenCapture.getSnapshot() || (polkitLock?.isLocked ?? false),
  isVault: isVaultWindow,
  appName: (window) => nameApp?.(window) ?? window.appId,
  openLauncher: (scope, window) => openLauncherIn(scope, window),
  openSettings: () => settingsApp.open("keyboard", "clipboard-history"),
  confirm: (question) => agentUi.confirmPerson(question),
  ...(launcherLanguages[0] ? { locale: launcherLanguages[0] } : {}),
});
const stopClipboardSource = actions.registry.add(clipboard.source);
// What other programs add: applets' commands, your scripts, GNOME's search providers; the registry on D-Bus (extensions/).
const extensions = startExtensions({
  registry: actions.registry,
  appletCommands,
  openLink: (url) => actions.openLink(url),
  open: (target) => openTarget(target, { openUrl: openFile, openLink: (url) => actions.openLink(url) }),
  copy: (text) => launcherClipboard.writeText(text),
  entries: () => appIndex.entries(),
  bus: portalHost,
});
void menus.shared.devices.refresh();
// What the launcher lists besides the apps (launcher/world.ts): the registry's actions for the person, and the
// windows, named as the switcher names them; a setting's switch redraws when Control Center flips it.
launcherWorld = new LauncherWorld({
  actions: () => actions.registry.list({ who: "person" }),
  onActions: (listener) => actions.registry.subscribe(listener),
  windows: () => compositor?.windows() ?? Promise.resolve([]),
  onWindows: (listener) =>
    compositor?.on((event) => {
      if (event.event === "window-opened" || event.event === "window-closed" || event.event === "window-state") listener();
    }) ?? (() => {}),
  appOf: (window) => {
    const entry = installedApp(window.appId);
    return { entryId: entry?.id ?? null, name: appFor(apps, window, installedApp).name, icon: entry?.icon ?? iconPath("generic") };
  },
  desktopOf: (window) => {
    const desktops = spaces?.controller.getSnapshot();
    if (!desktops || window.space === undefined || window.space === desktops.current) return undefined;
    return desktopWord(desktops.labels[window.space], appFor(apps, window, installedApp).name, window.space);
  },
  onState: (listener) => {
    const offs = [flags.subscribe(listener), menus.shared.devices.subscribe(listener), system.store.subscribe(listener), settingsStore.subscribe(listener)];
    return () => {
      for (const off of offs) off();
    };
  },
});
launcherHost = shellLauncherHost({
  compositor,
  actions,
  openSettings: (pane, row) => settingsApp.open(pane, row),
  launch: (entry) => launchEntry(entry),
  currentSpace: () => spaces?.controller.getSnapshot().current ?? null,
  openFile,
  pins,
  keymap: currentKeymap,
});
// Agents in the launcher (agents/ask/): Ask, the plan run by the person's own Return, Now, and the history.
// The answerer is Settings › Agents' choice; Claude's key is the vault's token item, else ANTHROPIC_API_KEY.
askAgents = startAsk({
  settings: settingsStore,
  agents: agentStore,
  turns: turnWatch,
  actions: () => actions.registry.list(),
  runApproved: (action, args, by) => actions.runApproved(action, args, by),
  runAsPerson: (address, args) => {
    const action = actions.registry.get(address);
    return action ? actions.run(action, args) : Promise.resolve({ ok: false, error: `Nothing is at ${address}.` });
  },
  personPressed: () =>
    compositor ? personAnswered((method, params) => compositor.request(method, params), LAUNCHER_MOTION.namespace) : Promise.resolve(false),
  settingNow: (name) => (agents && isSettingKey(name) ? settingState(agents.desktop, name) : null),
  focus: async (window) => {
    await compositor?.request("focus", { window });
  },
  stopAgent: (id) => agents?.stop(id),
  openSettings: () => settingsApp.open("agents"),
  // A harness that isn't signed in signs in there (agents/ask/harness/).
  openTerminal: () => {
    const terminal = actions.registry.get(formatAddress(["app", "dev.dashi.terminal"]));
    if (terminal) void actions.run(terminal, {});
  },
  keys: modelKeys(vaultTokenSource(passwords.vault.tokens)),
});
// A dashi:// link that must not run by itself (destructive, an agent's tool) opens in the launcher, filled in, for Return.
if (compositor) {
  actions.setPresenter((action, args) => {
    if (overlays.has("launcher")) closeOverlay("launcher");
    openLauncher({ action, args });
    return true;
  });
}
const stopShortcuts = compositor
  ? startShortcuts(compositor, {
      appShortcut,
      toggleLauncher: () => (overlays.has("launcher") ? closeOverlay("launcher") : openLauncher()),
      // While the launcher is open, holding ❖ shows the digits ❖1–9 pick instead (launcher/keys.ts).
      showSheet: () => {
        if (overlays.has("launcher") && launcherKeys.digits(true)) return;
        if (!overlays.has("sheet")) openSheet();
      },
      hideSheet: () => {
        launcherKeys.digits(false);
        closeOverlay("sheet");
      },
      forceQuit: () => forceQuit.open(),
      settings: () => settingsApp.open(),
      toggleAutohide: () => dockPrefs.toggleAutohide(),
      overview: { toggle: () => overview?.toggle() },
      ...(spaces ? { spaces: spaces.controller } : {}),
      switcher: switcherController ?? new SwitcherController(compositor, { show: showSwitcher, hide: () => closeOverlay("switcher") }),
      runAddress: async (address, window) => {
        const outcome = await actions.runAddress(address, window);
        if (!outcome.ok) console.error(`dashi-shell: the keymap binds ${address}: ${outcome.error}`);
      },
      hardware: system.hardware,
      lock: () => lockScreen?.lock(),
      powerKey: () => power.powerKey(),
      screenshotArea: selectArea,
      captureToolbar: (window) => captureTools?.toolbar(window),
      launcher: { binding: launcherBinding },
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
  const entryContext = { bun: process.execPath, root: shellDir, host: METAL_HOST };
  // And the dashi:// handler beside them (actions/entry.ts).
  const links = linksEntry(entryContext);
  void installDesktopEntries(installedSpecs(), entryContext, links ? { extra: [links] } : {});
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
      captureTools?.close();
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
    [
      "auto appearance",
      () => {
        stopFollowingAuto();
        stopAutoAppearance();
      },
    ],
    ["region", () => region.close()],
    ["file search", () => localSearch.close()],
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
    ["full-screen desktops", stopFullscreenDesktops],
    ["attention", () => attention?.close()],
    ["settings", stopSettings],
    ["input method", () => inputMethod?.stop()],
    ["settings file watch", stopWatchingSettings],
    ["wallpaper events", () => stopWallpaperEvents?.()],
    ["live wallpaper", () => liveWallpaper?.stop()],
    ["idle", () => idle?.stop()],
    [
      "keep awake",
      () => {
        stopFollowingHolds();
        stopTellingScreenSavers();
        void portalHost.then((host) => host?.close());
      },
    ],
    ["arranging", stopArranging],
    [
      "full screen",
      () => {
        stopHoldingBars();
        stopFullscreenBars();
      },
    ],
    ["system", () => system.close()],
    ["power", () => power.close()],
    ["agents", () => agents?.close()],
    ["token proxy", stopTokens],
    ["agent sheets", () => agentUi.close()],
    ["launcher world", () => launcherWorld?.close()],
    [
      "radios",
      () => {
        stopRadioSource();
        radioSource.close();
      },
    ],
    ["extensions", () => extensions.close()],
    ["person keys", stopFollowingPersonKeys],
    [
      "clipboard",
      () => {
        stopClipboardSource();
        clipboard?.close();
      },
    ],
    ["actions", () => actions.close()],
    ["ask", () => askAgents?.close()],
    ["flags", stopFollowingFlags],
    ["night shift", stopNightShift],
    ["screen recording", () => captureTools?.close()],
    ["screen sharing", () => capture?.stop()],
    ["battery alerts", stopBatteryAlerts],
    ["calendar", () => calendar.close()],
    ["appearance", stopAppearance],
    ["chrome", stopChrome],
    ["notifications", () => notifications.close()],
    ["file manager", () => void fileManager.then((service) => service?.close())],
    ["menus", () => menus.close()],
    ["app menus", () => appMenus.close()],
    ["applets", stopApplets],
    ["share picker", stopSharePicker],
    ["battery monitor", () => batteryMonitor.stop()],
    ["lost card watch", () => lostCard.close()],
    ["laptop", () => laptop.close()],
    ["tray", () => void tray.then((running) => running?.close())],
    ["dock animation targets", stopAnimationTargets],
    ["dock controller", () => dock.close()],
    ["ranking history", () => rankingMemory.close()],
    ["force quit", () => forceQuit.close()],
    ["settings app", () => settingsApp.close()],
    ["settings services", () => paneServices?.close()],
    ["overlays", () => overlays.closeAll()],
    [
      "launcher",
      () => {
        stopAppIndex();
        launchFailures.close();
      },
    ],
    ["screens", stopFollowingScreens],
    ["xwayland-scale", stopXwaylandScaling],
    [
      "display arrangement",
      () => {
        stopArrangements();
        displayLid?.close();
      },
    ],
    ["menu bars", () => menuBars.close()],
    ["dock", () => dockRuntime.close()],
  ]);
  process.exit(0);
};
process.on("SIGTERM", quit);
process.on("SIGINT", quit);
