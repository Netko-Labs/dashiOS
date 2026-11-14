/**
 * dashi-shell: the desktop's shell, in one process. The menu bars and the
 * Dock, the launcher, the sheets and overlays are Metal layer-shell surfaces
 * driven from here; so are the system services the shell keeps (settings,
 * power, notifications, agents, passwords, applets, Spaces, …).
 *
 *   WAYLAND_DISPLAY=<dashi-comp socket> bun src/main.tsx
 *
 * Started by hand (not by dashi-comp's `-c`), the compositor needs `--open-ipc`
 * to take it for the shell (docs/compositor-ipc.md, "Who may ask").
 *
 * This file is the start-up order and nothing else: each piece starts in
 * boot/ and says there how it stops (boot/services.ts), so the shell stops
 * them in the reverse order. Pieces a callback reaches before they are made
 * are in boot/parts.ts.
 */

import {
  appQuitting,
  appShortcut,
  chooseRadios,
  closeOnLock,
  connectCompositor,
  guardProcess,
  Late,
  type LateParts,
  type OverlayKind,
  Screens,
  Screenshots,
  Services,
  sheetOpener,
  startAgentBasics,
  startAgentServer,
  startArranging,
  startAskAgents,
  startBarHolds,
  startBarMenus,
  startBars,
  startCapsule,
  startCatalog,
  startDesktops,
  startGuards,
  startHandoff,
  startKeepingAwake,
  startKeys,
  startLauncher,
  startLogin,
  startLook,
  startMachine,
  startNotices,
  startOverview,
  startPickerAndTray,
  startPrograms,
  startRegistry,
  startSettingsApps,
  startSettingsWindows,
  startSpoken,
  startStores,
  startSwitcher,
  startSwitches,
  startSystemStores,
  startTalking,
} from "./boot/index.ts";
import { pickPrimary } from "./menubar/index.ts";
import { OverlaySlots } from "./overlay-slots.ts";
import { resolvePinned } from "./shared/apps/index.ts";
import { createPillHub } from "./shared/pill/index.ts";

const services = new Services();
const late = new Late<LateParts>();
// The night build's pieces meet here (docs/night-0.9-contract.md); each reaches it with `late.peek("pill")`.
late.set("pill", createPillHub());

guardProcess();
const apps = resolvePinned();
const compositor = await connectCompositor();
// A menu bar goes on every screen, the Dock on the primary one (menubars.ts).
const screens = new Screens(compositor);
const firstScreens = (await screens.names()) ?? [];
const primaryScreen = pickPrimary(firstScreens, screens.mainDisplay) ?? undefined;

// The windows, settings.json, the clocks; Spaces and the screens; how things look; where windows go.
const stores = startStores(services);
const { settingsStore } = stores;
// Talking to Dashi: the talk key, the voice service, the chip in every bar.
const talking = startTalking({ compositor, settingsStore, services, late });
const desktops = await startDesktops({ compositor, settingsStore, screens, services, late });
const look = startLook(compositor, desktops, stores.dockPrefs, services);
const arranging = await startArranging(compositor, desktops, services, late);
const radios = chooseRadios();
const overview = startOverview(compositor, desktops.spaces, services, late);

// The machine's state, the lock screen and power, and who may capture or ask for a password.
const system = startSystemStores(compositor, radios.wifi, look, services);
const guards = startGuards({ compositor, look, settingsStore, developmentRun: radios.developmentRun, services, late });

// Agents' groundwork, notifications and what speaks through them, Control Center's switches.
const basics = startAgentBasics(compositor, services, talking.voice);
const notices = startNotices(compositor, services);
const { notifications } = notices;
const screenshots = new Screenshots(compositor, { capture: guards.capture, notifications }, services, late);
startSpoken({ notifications, toplevels: stores.toplevels, system: system.system, developmentRun: radios.developmentRun, services, late });
const switches = startSwitches(compositor, { settingsStore, dockPrefs: stores.dockPrefs, notifications, look }, services);
const { registryStores } = switches;

// Force Quit, agents from the launcher and their server, System Settings and the Setup Assistant.
const settingsApps = startSettingsApps(compositor, system, services, late);
const handoff = startHandoff({ compositor, settingsStore, agentStore: basics.agentStore, notifications, registryStores, services, late });
const agents = late.set(
  "agents",
  startAgentServer({
    compositor,
    basics,
    handoff,
    stores,
    desktops,
    arranging,
    system,
    guards,
    notifications,
    switches,
    settings: settingsApps,
    screenshots,
    services,
    late,
  }),
);
const settingsWindows = startSettingsWindows({
  compositor,
  stores,
  desktops,
  system,
  guards,
  switches,
  passwords: basics.passwords,
  agentStore: basics.agentStore,
  alone: basics.alone,
  agents,
  talking,
  settingsApps,
  services,
  late,
});

// The apps: the catalog and the Dock's controller, keeping awake, apps' menus and applets, the picker and the tray.
const catalog = startCatalog({ compositor, apps, stores, desktops, settingsWindows, overview, services, late });
const awake = startKeepingAwake({ compositor, look, arranging, guards, catalog, toplevels: stores.toplevels, services });
const programs = startPrograms({ compositor, apps, catalog, toplevels: stores.toplevels, screens, services, late });
startPickerAndTray({ compositor, screens, spaces: desktops.spaces, notifications, extras: programs.extras, services, late });

// The laptop and the menus; the bars on every screen.
const machineNeeds = { compositor, apps, stores, desktops, look, system, guards, radios, notifications, catalog, programs, settingsWindows, services, late };
const machine = startMachine(machineNeeds);
const { menus, mixer } = startBarMenus({
  ...machineNeeds,
  machine,
  arranging,
  switches,
  settingsApps,
  handoffPanel: (props) => handoff.handoffShell.panel(props),
});
late.set("controlCenterEditor", menus.controlCenter);
const barTips = startBarHolds({ compositor, apps, catalog, notices, arranging, programs, menus, services });
startBars({
  compositor,
  apps,
  screens,
  firstScreens,
  primaryScreen,
  stores,
  look,
  catalog,
  awake,
  programs,
  menus,
  mixer,
  system,
  guards,
  agents: basics,
  handoff,
  screenshots,
  barTips,
  talking,
  services,
  late,
});

// The overlays on demand: the launcher, the shortcut sheet, the switcher; the app menus' shortcuts.
const overlays = late.set("overlays", new OverlaySlots<OverlayKind>());
services.add("overlays", () => overlays.closeAll());
const launcher = startLauncher({
  compositor,
  apps,
  screens,
  overlays,
  settingsStore,
  notifications,
  look,
  catalog,
  agentStore: basics.agentStore,
  agents,
  handoff,
  screenLocked: guards.screenLocked,
  services,
  late,
});
late.set("launcher", launcher.opener);
const openSheet = late.set(
  "openSheet",
  sheetOpener({
    overlays,
    screens,
    toplevels: stores.toplevels,
    apps,
    installedApp: catalog.installedApp,
    published: () => programs.appMenus.store.getSnapshot(),
  }),
);
const switcher = startSwitcher({ compositor, overlays, screens, installedApp: catalog.installedApp, rankingMemory: catalog.rankingMemory });
const shortcutOf = late.set("appShortcut", (window: number, shortcut: string) => appShortcut(compositor, programs.appMenus, window, shortcut));
screenshots.registerApp(services);

// The action registry and what reads it, Ask in the launcher, and the keys.
const registryNeeds = { compositor, apps, stores, desktops, arranging, system, guards, switches, agents, basics, settingsWindows, catalog, awake, programs };
const { actions } = startRegistry({ ...registryNeeds, menus, screenshots, launcher, services, late });
late.set("askAgents", startAskAgents({ compositor, settingsStore, basics, agents, actions, registryStores, services, late }));
startCapsule({ compositor, talking, look, services, late });
startKeys({
  compositor,
  screens,
  stores,
  desktops,
  system,
  guards,
  settingsApps,
  settingsWindows,
  programs,
  menus,
  actions,
  launcher,
  switcher,
  overview,
  openSheet,
  appShortcut: shortcutOf,
  appQuitting: (pid) => appQuitting(programs.appMenus, pid),
  services,
  late,
});

// Once the bars are up: the Setup Assistant at a first login, autostart; and the lock takes everything down.
startLogin(compositor, settingsWindows.setupAssistant, radios.developmentRun, services);
closeOnLock(compositor, { menus, overlays, screenshots }, services);

// One surface gone, or a signal, means the session is going away. Every service stops, the last
// started first, each on its own (one that throws must not leave the rest running), then the process
// ends. A stop that ends a surface asks again; that second ask does nothing.
const quit = late.set("quit", () => {
  if (!services.isRunning()) return;
  services.closeAll();
  process.exit(0);
});
process.on("SIGTERM", quit);
process.on("SIGINT", quit);
