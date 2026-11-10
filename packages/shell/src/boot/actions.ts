/**
 * The action registry and what reads it (main.tsx): every command at a
 * dashi:// address (actions/, docs/actions.md), Wi-Fi and Bluetooth as
 * settings, the clipboard history, other programs' commands, what the launcher
 * lists and reaches, dashi:// links shown in the launcher, and the keymap.
 */

import { type Actions, RadioSource, startActions } from "../actions/index.ts";
import { type Agents, isVaultWindow } from "../agents/index.ts";
import { appFor } from "../apps.ts";
import { type Clipboard, startClipboard } from "../clipboard/index.ts";
import type { Compositor } from "../compositor/index.ts";
import { launchEntry } from "../entries.ts";
import { type Extensions, openTarget, startExtensions } from "../extensions/index.ts";
import { openFile } from "../file-manager.ts";
import { windowToFront } from "../front-window.ts";
import { currentKeymap } from "../keymap/keymap-state.ts";
import { shellLauncherHost } from "../launcher/shell-host.ts";
import { desktopWord, LauncherWorld } from "../launcher/world.ts";
import type { Menus } from "../menus/index.ts";
import { type App, iconPath } from "../shared/apps/index.ts";
import type { AgentBasics } from "./agents.ts";
import type { Catalog, KeepingAwake, Programs } from "./apps.ts";
import type { Arranging, Desktops } from "./desktop.ts";
import type { LauncherParts } from "./launcher.tsx";
import type { Switches } from "./notices.ts";
import type { Screenshots } from "./overlays.tsx";
import type { LateParts } from "./parts.ts";
import type { Late, Services } from "./services.ts";
import type { Stores } from "./session.ts";
import type { SettingsWindows } from "./settings.ts";
import type { Guards, SystemStores } from "./system.ts";

interface RegistryNeeds {
  compositor: Compositor | null;
  apps: App[];
  stores: Stores;
  desktops: Desktops;
  arranging: Arranging;
  system: SystemStores;
  guards: Guards;
  switches: Switches;
  agents: Agents | null;
  basics: AgentBasics;
  settingsWindows: SettingsWindows;
  catalog: Catalog;
  awake: KeepingAwake;
  programs: Programs;
  menus: Menus;
  screenshots: Screenshots;
  launcher: LauncherParts;
  services: Services;
  late: Late<LateParts>;
}

export interface Registry {
  actions: Actions;
  clipboard: Clipboard;
  extensions: Extensions;
}

/**
 * The action registry (actions/, docs/actions.md): every command at a dashi:// address, read by the
 * keymap's address bindings, dashi:// links (xdg-open, on $XDG_RUNTIME_DIR/dashi-links.sock), and
 * agents' tools/list. Then the sources added to it, and what the launcher reads from it.
 */
export function startRegistry(needs: RegistryNeeds): Registry {
  const { compositor, catalog, arranging, services, late } = needs;
  const { arranger } = arranging;
  const actions = late.set(
    "actions",
    startActions({
      compositor,
      agents: needs.agents,
      confirmPerson: (question) => needs.basics.agentUi.confirmPerson(question),
      entries: () => catalog.catalog,
      launch: launchEntry,
      // A key or link that opens an app brings its window forward when it has one, as the Dock does.
      activate: async (entry) => {
        const windows = (await compositor?.windows().catch(() => [])) ?? [];
        const own = windows.filter((window) => catalog.installedApp(window.appId)?.id === entry.id);
        const target = windowToFront(own);
        if (!target || !compositor) return false;
        await compositor.focus({ window: target.id });
        return true;
      },
      appMenus: needs.programs.appMenus.store,
      appName: (window) => late.peek("nameApp")?.(window) ?? window.appId,
      arrange: arranger
        ? { arrow: (window, arrow) => arranger.arrow(window, arrow), tile: arranging.tile, fullscreen: (window) => arranger.toggleFullscreen(window) }
        : null,
      runMenu: (action) => needs.menus.run(action, "Dashi"),
      ...(compositor ? { capture: needs.screenshots.run } : {}),
      openSettings: (pane, row) => needs.settingsWindows.settingsApp.open(pane, row),
      settingsStores: needs.switches.registryStores,
      keymap: currentKeymap(),
    }),
  );
  services.add("actions", () => actions.close());
  addRadios(needs, actions);
  const clipboard = startClipboardHistory(needs, actions);
  // What other programs add: applets' commands, your scripts, GNOME's search providers; the registry on D-Bus (extensions/).
  const extensions = late.set(
    "extensions",
    startExtensions({
      registry: actions.registry,
      appletCommands: needs.programs.appletCommands,
      openLink: (url) => actions.openLink(url),
      open: (target) => openTarget(target, { openUrl: openFile, openLink: (url) => actions.openLink(url) }),
      copy: (text) => late.get("launcherClipboard").writeText(text),
      entries: () => needs.launcher.appIndex.entries(),
      bus: needs.awake.portalHost,
    }),
  );
  services.add("extensions", () => extensions.close());
  void needs.menus.shared.devices.refresh();
  startLauncherWorld(needs, actions);
  return { actions, clipboard, extensions };
}

/** Wi-Fi and Bluetooth as settings with state, from Control Center's own store (actions/sources/radios.ts). */
function addRadios({ menus, system, services }: RegistryNeeds, actions: Actions): void {
  const devices = menus.shared.devices;
  const radioSource = new RadioSource({
    wifi: () => devices.getSnapshot().wifi,
    bluetooth: () => devices.getSnapshot().bluetooth,
    network: () => {
      const network = system.system.store.getSnapshot().network;
      return network?.kind === "wifi" && network.ssid ? network.ssid : null;
    },
    setWifi: (on) => devices.setWifi(on),
    setBluetooth: (on) => devices.setBluetooth(on),
    subscribe: (listener) => {
      const offs = [devices.subscribe(listener), system.system.store.subscribe(listener)];
      return () => {
        for (const off of offs) off();
      };
    },
  });
  const stopRadioSource = actions.registry.add(radioSource);
  services.add("radios", () => {
    stopRadioSource();
    radioSource.close();
  });
}

/**
 * Clipboard history (⌥❖V) and snippets: copies from the compositor's data-control, kept by the privacy
 * rules, in the launcher's scopes; nothing kept while the screen is shared, recorded, or locked (clipboard/).
 */
function startClipboardHistory({ compositor, stores, guards, basics, settingsWindows, launcher, services, late }: RegistryNeeds, actions: Actions): Clipboard {
  const clipboard = late.set(
    "clipboard",
    startClipboard({
      compositor,
      settings: stores.settingsStore,
      paused: () => guards.screenCapture.getSnapshot() || (guards.polkitLock?.isLocked ?? false),
      isVault: isVaultWindow,
      appName: (window) => late.peek("nameApp")?.(window) ?? window.appId,
      openLauncher: (scope, window) => launcher.opener.openIn(scope, window),
      openSettings: () => settingsWindows.settingsApp.open("keyboard", "clipboard-history"),
      confirm: (question) => basics.agentUi.confirmPerson(question),
      ...(launcher.languages[0] ? { locale: launcher.languages[0] } : {}),
    }),
  );
  const stopClipboardSource = actions.registry.add(clipboard.source);
  services.add("clipboard", () => {
    stopClipboardSource();
    clipboard.close();
  });
  return clipboard;
}

/**
 * What the launcher lists besides the apps (launcher/world.ts): the registry's actions for the person, and the
 * windows, named as the switcher names them; a setting's switch redraws when Control Center flips it. And
 * what its verbs reach (launcher/shell-host.ts).
 */
function startLauncherWorld(needs: RegistryNeeds, actions: Actions): void {
  const { compositor, apps, catalog, desktops, switches, menus, system, stores, services, late } = needs;
  const world = late.set(
    "launcherWorld",
    new LauncherWorld({
      actions: () => actions.registry.list({ who: "person" }),
      onActions: (listener) => actions.registry.subscribe(listener),
      windows: () => compositor?.windows() ?? Promise.resolve([]),
      onWindows: (listener) =>
        compositor?.on((event) => {
          if (event.event === "window-opened" || event.event === "window-closed" || event.event === "window-state") listener();
        }) ?? (() => {}),
      appOf: (window) => {
        const entry = catalog.installedApp(window.appId);
        return { entryId: entry?.id ?? null, name: appFor(apps, window, catalog.installedApp).name, icon: entry?.icon ?? iconPath("generic") };
      },
      desktopOf: (window) => {
        const spaces = desktops.spaces?.controller.getSnapshot();
        if (!spaces || window.space === undefined || window.space === spaces.current) return undefined;
        return desktopWord(spaces.labels[window.space], appFor(apps, window, catalog.installedApp).name, window.space);
      },
      onState: (listener) => {
        const offs = [
          switches.flags.subscribe(listener),
          menus.shared.devices.subscribe(listener),
          system.system.store.subscribe(listener),
          stores.settingsStore.subscribe(listener),
        ];
        return () => {
          for (const off of offs) off();
        };
      },
    }),
  );
  services.add("launcher world", () => world.close());
  late.set(
    "launcherHost",
    shellLauncherHost({
      compositor,
      actions,
      openSettings: (pane, row) => needs.settingsWindows.settingsApp.open(pane, row),
      launch: (entry) => launchEntry(entry),
      currentSpace: () => desktops.spaces?.controller.getSnapshot().current ?? null,
      openFile,
      pins: catalog.pins,
      keymap: currentKeymap,
    }),
  );
}
