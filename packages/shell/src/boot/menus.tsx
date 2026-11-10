/**
 * The machine and the menu bar's menus (main.tsx): the laptop's power modes and
 * graphics card, the refresh rate on battery, mirroring, the apps' sound, and
 * the menus, Control Center and the battery panel that show them.
 */

import type { Compositor } from "../compositor/index.ts";
import { AutoRefresh, MirrorStore, rateOnPower } from "../display-config/index.ts";
import { bottomInset } from "../dock/index.ts";
import { startLostCardWatch } from "../graphics/lost-start.ts";
import { keepAwake, keepAwakeEntries } from "../inhibit/index.ts";
import { type Laptop, laptopEntries, startLaptop } from "../laptop/index.ts";
import { OverflowRow } from "../menubar/index.ts";
import { extraEntries, type Menus, type StatusMenuAction, startMenus, useMenus } from "../menus/index.ts";
import type { Notifications } from "../notifications/index.ts";
import { chargeTarget } from "../power/battery-health.ts";
import { powerOffReason } from "../power/nested.ts";
import type { App } from "../shared/apps/index.ts";
import { setControlMotion } from "../shared/controls/index.ts";
import { isPaneId } from "../shared/settings/panes.ts";
import { startAppMixer } from "../sound/apps/index.ts";
import { MENU_BAR_HEIGHT } from "../theme.ts";
import type { Catalog, Programs } from "./apps.ts";
import type { Arranging, Desktops } from "./desktop.ts";
import type { Look } from "./look.ts";
import type { Switches } from "./notices.ts";
import type { LateParts } from "./parts.ts";
import type { Late, Services } from "./services.ts";
import type { Stores } from "./session.ts";
import type { SettingsApps, SettingsWindows } from "./settings.ts";
import type { Guards, Radios, SystemStores } from "./system.ts";

export interface Machine {
  laptop: Laptop;
  autoRefresh: AutoRefresh | null;
  /** The charge limit in effect (Battery Settings), for the battery row's tick and the battery panel. */
  chargeLimit: () => number | null;
  mirror: MirrorStore | null;
}

interface MachineNeeds {
  compositor: Compositor | null;
  apps: App[];
  stores: Stores;
  desktops: Desktops;
  look: Look;
  system: SystemStores;
  guards: Guards;
  radios: Radios;
  notifications: Notifications;
  catalog: Catalog;
  programs: Programs;
  settingsWindows: SettingsWindows;
  services: Services;
  late: Late<LateParts>;
}

/** The laptop (power modes, battery health, its keys, saved tuning, the graphics card), the refresh rate, and mirroring. */
export function startMachine(needs: MachineNeeds): Machine {
  const { compositor, stores, system, notifications, catalog, services, late } = needs;
  const { settingsStore } = stores;
  // The graphics card falling off the bus is said once, and apps stop being offloaded to it (graphics/).
  const lostCard = startLostCardWatch({ notifications: notifications.store, restart: () => late.get("menus").confirmPower("restart") });
  services.add("lost card watch", () => lostCard.close());
  // The laptop: power modes in sync with the firmware, battery health, its keys, saved tuning, the graphics card (laptop/).
  const laptop = startLaptop({
    compositor,
    settings: settingsStore,
    system: system.system,
    notifications: notifications.store,
    developmentRun: needs.radios.developmentRun,
    realSession: powerOffReason() === null,
    lostCard,
    nameOf: (window) => catalog.nameApp(window),
    openSettings: (pane) => needs.settingsWindows.settingsApp.open(pane),
    confirmRestart: () => late.get("menus").confirmPower("restart"),
    // Asked only once a switch has held (seconds after login), when the refresh rate below exists.
    refreshRate: (plugged) => {
      const refresh = late.get("autoRefresh");
      return refresh ? rateOnPower(refresh.getSnapshot(), plugged) : null;
    },
  });
  late.set("laptop", laptop);
  services.add("laptop", () => laptop.close());
  // An applet's pick of the power mode is the same as one in Control Center.
  needs.programs.appletPower.connect(laptop.modes);
  const autoRefresh = late.set("autoRefresh", startAutoRefresh(needs));
  // Control Center's tiles step their corners and pages only while Reduce Motion is off (control-center/motion.ts).
  setControlMotion(() => needs.look.state.reduceMotion);
  const chargeLimit = (): number | null => {
    if (!laptop.store.getSnapshot().knobs.has("charge-limit")) return null;
    const target = chargeTarget(settingsStore.getSnapshot().data.power, new Date()).percent;
    return target !== null && target < 100 ? target : null;
  };
  // Mirroring the screens: Control Center's tile (display-config/mirror.ts).
  const mirror = compositor ? new MirrorStore(compositor) : null;
  const stopMirror = mirror?.start();
  services.add("mirroring", () => stopMirror?.());
  return { laptop, autoRefresh, chargeLimit, mirror };
}

/**
 * Automatic refresh rate: the built-in screen at its top rate plugged in, about 60 Hz on battery
 * (display-config/auto-refresh.ts). Nothing is set while the screens are blanked or the session is locked.
 */
function startAutoRefresh({ compositor, stores, desktops, look, system, guards, services }: MachineNeeds): AutoRefresh | null {
  const { displays } = desktops;
  const { idle } = look;
  let screensBlanked = false;
  const autoRefresh = displays
    ? new AutoRefresh({
        displays,
        choice: (name) => stores.settingsStore.displayRefresh(name),
        ready: () => !screensBlanked && !guards.screenLocked(),
        watch: (listener) => compositor?.on((event) => event.event === "outputs-changed" && listener()) ?? (() => {}),
      })
    : null;
  services.add("refresh rate", autoRefresh?.start() ?? (() => {}));
  if (!autoRefresh) return null;
  const followPower = () => {
    const battery = system.system.store.getSnapshot().battery;
    autoRefresh.setPlugged(battery === null || battery.state !== "discharging");
  };
  system.system.store.subscribe(followPower);
  followPower();
  stores.settingsStore.subscribe(() => autoRefresh.settingsChanged());
  guards.polkitLock?.onChange(() => autoRefresh.readyChanged());
  if (idle) {
    const before = idle.onBlanked;
    idle.onBlanked = (blanked) => {
      before?.(blanked);
      screensBlanked = blanked;
      autoRefresh.readyChanged();
    };
  }
  return autoRefresh;
}

interface MenusNeeds extends MachineNeeds {
  machine: Machine;
  arranging: Arranging;
  switches: Switches;
  settingsApps: SettingsApps;
  handoffPanel: Parameters<typeof startMenus>[0]["agentsPanel"];
}

/** The battery panel's stores, and the rows the laptop and what keeps it awake add to it. */
function batteryPanel({ stores, system, catalog, programs, machine }: MenusNeeds): Parameters<typeof startMenus>[0]["battery"] {
  const { laptop } = machine;
  return {
    system: system.system.store,
    monitor: programs.batteryMonitor,
    // The graphics card's holders are read again as the panel opens.
    refresh: () => void laptop.graphics.refresh(),
    // What the laptop adds (the charge, the card's holders: laptop/menu.ts) and what keeps it awake (inhibit/menu.ts).
    extras: () => [
      ...laptopEntries<StatusMenuAction>(
        {
          laptop: laptop.store.getSnapshot(),
          modes: laptop.modes.getSnapshot(),
          graphics: laptop.graphics.getSnapshot(),
          power: stores.settingsStore.getSnapshot().data.power,
          now: new Date(),
        },
        (action) => ({ kind: "laptop", action }),
      ),
      ...keepAwakeEntries(keepAwake().awake(), (id) => catalog.installedApp(id)?.name ?? id, { kind: "allow-sleep" as const }),
    ],
  };
}

export interface BarMenus {
  mixer: ReturnType<typeof startAppMixer>;
  menus: Menus;
}

/** The apps' sound, and the menu bar's menus, Control Center and the battery panel (menus/, control-center/, battery/). */
export function startBarMenus(needs: MenusNeeds): BarMenus {
  const { compositor, apps, stores, system, catalog, programs, machine, services, late } = needs;
  const { dockPrefs } = stores;
  const { laptop } = machine;
  // The apps' sound: one pw-dump --monitor for the session, for Control Center, Settings, the
  // microphone indicator and agents (sound/apps/). A development run reads the host, never writes.
  const mixer = startAppMixer({
    compositor,
    apps,
    entries: () => catalog.catalog,
    installed: catalog.installedApp,
    standIn: needs.radios.wifi.fake,
    pipewire: system.pipewire,
  });
  services.add("sound watch", () => mixer.stop());
  const menus = startMenus({
    mixer,
    pipewire: system.pipewire,
    // The bar's ring is spoken from the popover's surface (menus/lib/popover.tsx).
    accessible: () => late.get("launcherAccess").accessible,
    layout: programs.controlLayout,
    appletControls: programs.appletControls,
    chargeLimit: machine.chargeLimit,
    ...(machine.mirror ? { mirror: machine.mirror } : {}),
    battery: batteryPanel(needs),
    openSettingsPane: (pane) => isPaneId(pane) && needs.settingsWindows.settingsApp.open(pane),
    appMenus: programs.appMenus.store,
    apps,
    catalog: catalog.catalog,
    compositor,
    arranger: needs.arranging.arranger,
    ...(needs.desktops.spaces ? { desktops: needs.desktops.spaces.controller } : {}),
    system: system.system.store,
    brightnessChanged: system.system.brightnessChanged,
    notifications: needs.notifications.store,
    wifi: needs.radios.wifi,
    wifiStore: system.wifiStore,
    bluetooth: needs.radios.bluetooth,
    lock: () => needs.guards.lockScreen?.lock(),
    sleep: () => void needs.guards.power.suspend(),
    openForceQuit: () => needs.settingsApps.forceQuit.open(),
    openSettings: () => needs.settingsWindows.settingsApp.open(),
    // Search… in the Dashi menu (launcher.tsx).
    openSearch: () => late.get("launcher").show(),
    // Without a compositor the Dock cannot hear the pointer, so it never autohides (dock/presenter.ts).
    // The Dock is on the primary screen only.
    dockInset: (output) =>
      output === undefined || output === late.get("menuBars").primaryName
        ? bottomInset({ ...dockPrefs.snapshot, autohide: dockPrefs.snapshot.autohide && compositor !== null })
        : 0,
    runDock: (action) => catalog.dock.run(action).catch((error) => console.error(`dashi-shell: Dock “${action.kind}” failed:`, error)),
    runStatus: (action) =>
      action.kind === "extra"
        ? programs.extras.choose(action.key, action.id)
        : action.kind === "laptop"
          ? laptop.run(action.action)
          : action.kind === "allow-sleep"
            ? keepAwake().ignoreAll()
            : needs.settingsWindows.settingsApp.open("battery"),
    laptop,
    statusClosed: (key) => programs.extras.menuClosed(key),
    agentsPanel: needs.handoffPanel,
    // "…": the status items the bar had no room for, each working as it does there (bar-overflow.tsx).
    overflowRow: ({ right, keys, close, escape }) => (
      <OverflowRowFor menus={late.get("menus")} programs={programs} system={system} right={right} keys={keys} close={close} escape={escape} />
    ),
    showShortcuts: (appName) => {
      if (!late.get("overlays").has("sheet")) late.get("openSheet")(true, appName);
    },
  });
  late.set("menus", menus);
  services.add("menus", () => menus.close());
  return { mixer, menus };
}

interface OverflowRowForProps {
  menus: Menus;
  programs: Programs;
  system: SystemStores;
  right: number;
  keys: readonly string[];
  close: () => void;
  escape: () => void;
}

/** "…"'s row with the bar's stores: an item's menu, or Control Center, takes the row's place. */
function OverflowRowFor({ menus, programs, system, right, keys, close, escape }: OverflowRowForProps) {
  const { extras } = programs;
  const { popover, appName, output } = useMenus(menus.controller);
  const name = appName ?? "Desktop";
  return (
    <OverflowRow
      keys={keys}
      right={right}
      extras={extras}
      system={system.system.store}
      openKey={popover?.kind === "status-menu" ? popover.key : null}
      onClose={close}
      onEscape={escape}
      actions={{
        menu: (extra, at) =>
          void extras.menu(extra.key).then((rows) => {
            if (rows.length > 0) void menus.controller.toggleStatusMenu(extra.key, at, extraEntries(extra.key, rows), name, output);
          }),
        // The row's surface starts under the bar; the item is told where it is on the screen.
        activate: (extra, x, y) => extras.activate(extra.key, x, y + MENU_BAR_HEIGHT, output),
        controlCenter: (page) => void menus.controller.toggleControlCenter(name, page, output),
      }}
    />
  );
}
