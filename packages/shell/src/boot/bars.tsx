/**
 * The bars (main.tsx): a menu bar on every screen and the Dock on the primary
 * one, following the screens as they come and go; the bar's tooltips, what
 * keeps the bar's menus up, and what Restart and Shut Down say while they wait.
 */

import { joinShellMenus } from "../applets/popovers.ts";
import { appFor } from "../apps.ts";
import type { Compositor } from "../compositor/index.ts";
import { AnimationTargets, dockScreen, startDock, TileStore } from "../dock/index.ts";
import { barHold, MenuBar, MenuBars, startBarTips } from "../menubar/index.ts";
import type { Menus } from "../menus/index.ts";
import type { NotifyInput } from "../notifications/index.ts";
import { openOverlay } from "../overlay.tsx";
import type { App } from "../shared/apps/index.ts";
import { configureMachineEnd } from "../shutdown.ts";
import { MENU_BAR_HEIGHT } from "../theme.ts";
import { startXwaylandScaling } from "../xwayland-scale.ts";
import type { AgentBasics, Handoff } from "./agents.ts";
import type { Catalog, KeepingAwake, Programs } from "./apps.ts";
import type { Arranging } from "./desktop.ts";
import type { Look } from "./look.ts";
import type { BarMenus } from "./menus.tsx";
import type { Notices } from "./notices.ts";
import type { Screenshots } from "./overlays.tsx";
import type { LateParts } from "./parts.ts";
import type { Late, Services } from "./services.ts";
import type { Screens, Stores } from "./session.ts";
import type { Guards, SystemStores } from "./system.ts";

/** What Restart or Shut Down says when apps aren't closing: who, and how long until the machine goes without them. */
export function machineEndNotice(names: readonly string[], seconds: number, what: "restart" | "shutdown"): NotifyInput {
  return {
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
  };
}

interface HoldNeeds {
  compositor: Compositor | null;
  apps: App[];
  catalog: Catalog;
  notices: Notices;
  arranging: Arranging;
  programs: Programs;
  menus: Menus;
  services: Services;
}

/** The bar's tooltips, how the machine ends, and what keeps the bar and its menus up. */
export function startBarHolds({ compositor, apps, catalog, notices, arranging, programs, menus, services }: HoldNeeds): ReturnType<typeof startBarTips> {
  /** The bar's tooltip (the agent mark's words), a small surface under it. */
  const barTips = startBarTips(openOverlay);

  // Restart and Shut Down give the apps 10 s, then go regardless of what is stuck (shutdown.ts).
  configureMachineEnd({
    processes: async () => {
      const windows = compositor ? await compositor.windows() : [];
      const byPid = new Map(
        windows.flatMap((window) =>
          window.pid === null || window.pid === process.pid ? [] : [[window.pid, appFor(apps, window, catalog.installedApp).name] as const],
        ),
      );
      return [...byPid].map(([pid, name]) => ({ pid, name }));
    },
    waiting: (names, seconds, what) => notices.notifications.store.notify(machineEndNotice(names, seconds, what)),
  });
  // A menu open on the revealed bar keeps it there (fullscreen.ts), and keeps the app's menus in the bar;
  // so does the keyboard in the bar (⌃F2, menus/bar-keys.ts), with nothing open yet.
  // So does a shell sheet that took the keyboard for the app in front (bar-hold.ts): the bar keeps its menus.
  const menusUp = (): boolean => {
    const { popover, bar } = menus.controller.getSnapshot();
    return popover !== null || bar !== undefined;
  };
  const holdAppMenus = (): void => programs.appMenus.hold(menusUp() || barHold.getSnapshot());
  const stopHoldingForPopovers = menus.controller.subscribe(() => {
    arranging.fullscreenBars?.hold(menusUp());
    holdAppMenus();
  });
  // A shell menu or panel opening closes an applet's popover, and the other way round (applets/popovers.ts).
  const stopJoiningPopovers = joinShellMenus(programs.appletPopovers, menus.controller);
  const stopHoldingForSheets = barHold.subscribe(holdAppMenus);
  services.add("bar holds", () => {
    stopHoldingForPopovers();
    stopHoldingForSheets();
    stopJoiningPopovers();
  });
  return barTips;
}

interface BarsNeeds {
  compositor: Compositor | null;
  apps: App[];
  screens: Screens;
  firstScreens: string[];
  primaryScreen: string | undefined;
  stores: Stores;
  look: Look;
  catalog: Catalog;
  awake: KeepingAwake;
  programs: Programs;
  menus: Menus;
  mixer: BarMenus["mixer"];
  system: SystemStores;
  guards: Guards;
  agents: AgentBasics;
  handoff: Handoff;
  screenshots: Screenshots;
  barTips: ReturnType<typeof startBarTips>;
  services: Services;
  late: Late<LateParts>;
}

/**
 * The Dock sits on the primary screen (dock/start.tsx: the Dock or the taskbar). Unplug that screen
 * and the Dock is opened again on the one that takes over (the menu bars decide which); a Dock
 * surface dying with its screen still there ends the shell.
 */
export function startBars(needs: BarsNeeds): MenuBars {
  const { compositor, screens, stores, catalog, services, late } = needs;
  const dockTiles = new TileStore();
  const dockRuntime = startDock({
    tiles: dockTiles,
    prefs: stores.dockPrefs,
    apps: needs.apps,
    catalog: catalog.catalog,
    pins: catalog.pins,
    toplevels: stores.toplevels,
    controller: catalog.dock,
    menus: needs.menus.controller,
    attention: needs.awake.attention,
    compositor,
    onLost: (output) => void primaryHostLost(output),
    reduceMotion: () => needs.look.state.reduceMotion,
  });
  services.add("dock", () => dockRuntime.close());
  dockRuntime.place(needs.primaryScreen);
  // Windows minimize toward their Dock tiles: the compositor draws it, the Dock knows where the tiles are (dock/animation-targets.ts).
  const stopAnimationTargets = compositor
    ? new AnimationTargets({
        compositor,
        catalog: catalog.catalog,
        tiles: dockTiles,
        placement: async () => {
          const screen = dockScreen(await compositor.outputs(), menuBars.primaryName ?? needs.primaryScreen);
          return screen ? { screen, style: stores.dockPrefs.snapshot.style } : null;
        },
      }).start()
    : () => {};
  services.add("dock animation targets", stopAnimationTargets);

  // The Dock's host died: if its screen is still there the shell ends (the
  // session restarts it); if the screen just left, everything moves to another.
  async function primaryHostLost(output: string | undefined): Promise<void> {
    const names = await screens.names();
    if (output === undefined || names === null || names.includes(output)) return late.get("quit")();
    followScreens(names);
  }

  /** The screens changed: bars on each, and the primary (with the Dock) on one that is left. */
  function followScreens(names: string[]): void {
    menuBars.sync(names, screens.mainDisplay);
    const primary = menuBars.primaryName;
    if (primary !== null) dockRuntime.place(primary);
  }

  // One bar per screen, all of the same MenuBar. The primary's host dying with
  // its screen still there ends the shell (below); a bar of a screen that was
  // unplugged just goes, and if it was the primary the primary moves.
  const menuBars = late.set(
    "menuBars",
    new MenuBars({
      open: (output, onClosed, primary) => openMenuBar(needs, output, onClosed, primary),
      onPrimaryLost: () => late.get("quit")(),
      onPrimaryChanged: (name) => dockRuntime.place(name),
      screens: () => screens.names(),
    }),
  );
  services.add("menu bars", () => menuBars.close());
  menuBars.start(needs.firstScreens, screens.mainDisplay);
  const stopFollowingScreens = compositor
    ? compositor.on((event) => {
        if (event.event === "outputs-changed") void screens.names().then((names) => names && followScreens(names));
      })
    : () => {};
  services.add("screens", stopFollowingScreens);
  // X11 apps drawn at the screens' scale, not stretched (xwayland-scale.ts).
  const { state } = needs.look;
  state.xwaylandScaling = compositor ? startXwaylandScaling({ compositor, choice: () => state.xwaylandChoice }) : null;
  services.add("xwayland-scale", () => state.xwaylandScaling?.stop());
  return menuBars;
}

/** One screen's menu bar; the primary's host also reports the windows. */
function openMenuBar(needs: BarsNeeds, output: string | undefined, onClosed: () => void, primary: boolean) {
  const { stores, programs, late } = needs;
  return openOverlay(
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
      apps={needs.apps}
      toplevels={stores.toplevels}
      agents={needs.agents.agentStore}
      capture={needs.guards.screenCapture}
      {...(needs.screenshots.tools ? { recorder: needs.screenshots.tools.recorder } : {})}
      system={needs.system.system.store}
      menus={needs.menus.controller}
      appMenus={programs.appMenus.store}
      extras={programs.extras}
      settings={stores.settingsStore}
      {...(output === undefined ? {} : { output })}
      runs={needs.handoff.handoffShell.service.runs}
      installed={needs.catalog.installedApp}
      mixer={needs.mixer}
      onTip={(tip) => needs.barTips.show(tip)}
      reduceMotion={() => needs.look.state.reduceMotion}
      accessible={() => late.get("launcherAccess").accessible}
    />,
    onClosed,
    primary ? (host) => stores.toplevels.attach(host) : undefined,
  );
}
