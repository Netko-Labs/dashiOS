/**
 * Brings the menu bar's menus, Control Center, and the notification center
 * to life: the popover surface, the sheets, and what choosing a row does, wired to the
 * compositor, the arranger, the lock screen, and the system.
 */

import { AppMenuStore, ownerPids } from "../app-menus/index.ts";
import type { Compositor } from "../compositor.ts";
import { type Entry, loadEntries } from "../entries.ts";
import { openOverlay } from "../overlay.tsx";
import { MenuController } from "./controller.ts";
import { findEntry } from "./launch.ts";
import { runMenuAction } from "./lib/actions.ts";
import { energyOpener } from "./lib/activity-monitor.ts";
import { popoverSurface } from "./lib/popover.tsx";
import { menuStores, powerDialogs } from "./lib/stores.ts";
import { actionDeps, controlCenterProps, menuContexts, popoverElement } from "./lib/wiring.tsx";
import type { Menus, MenusOptions } from "./options.ts";
import type { MenuAction, PowerKind } from "./types.ts";

/** An app's window that took a second start's file (Preview's empty one) comes forward, as a new window would have. */
function raiseOnSecondStart(compositor: Compositor | null, appMenus: AppMenuStore): void {
  appMenus.onFront((pid) => {
    if (!compositor) return;
    void compositor
      .windows()
      .then((windows) => {
        const window = windows.find((each) => ownerPids(each.pid).includes(pid));
        return window ? compositor.focus({ window: window.id }) : undefined;
      })
      .catch(() => {});
  });
}

export function startMenus(options: MenusOptions): Menus {
  const { compositor, pipewire } = options;
  const appMenus = options.appMenus ?? new AppMenuStore();
  let entries: readonly Entry[] | null = options.catalog ?? null;
  const entryFor = (appId: string) => findEntry((entries ??= loadEntries()), appId);

  // The sheet names the app the menu was opened over, which no longer has the keyboard.
  let lastAppName = "Desktop";
  // A confirmed restart, shut down, or log out asks the apps to close first (closing-apps.ts).
  const dialogs = powerDialogs(options, appMenus, entryFor);
  const closeMenus = (): void => controller.close();
  const stores = menuStores(options, closeMenus);
  const { context, menusOf } = menuContexts(options, appMenus, entryFor);
  const chargeLimit = options.chargeLimit ?? (() => null);
  const controlCenter = controlCenterProps(options, stores, closeMenus, chargeLimit);
  const controller: MenuController = new MenuController({
    context,
    openSurface: (onClosed, output) =>
      openOverlay(
        { title: "Menu", width: 1, height: 1, surface: popoverSurface(output) },
        popoverElement({
          options,
          controller,
          appMenus,
          controlCenter,
          chargeLimit,
          showEnergy,
          onChoose: (action, appName) => {
            lastAppName = appName;
            run(action);
          },
        }),
        onClosed,
      ),
  });

  const confirmPower = (what: PowerKind) => dialogs.confirm(what);
  // While the notification center is open the banners are in it, so none show.
  const syncCenter = () => options.notifications.setCenterOpen(controller.getSnapshot().popover?.kind === "notification-center");
  const stopSyncingCenter = controller.subscribe(syncCenter);

  const deps = actionDeps({ options, appMenus, entryFor, dialogs, lastAppName: () => lastAppName });

  // The battery menu's apps: Activity Monitor's Energy tab, with the app chosen selected.
  const showEnergy = energyOpener(compositor, appMenus, entryFor);

  raiseOnSecondStart(compositor, appMenus);

  const run = (action: MenuAction): void => {
    runMenuAction(action, deps).catch((error) => console.error(`dashi-shell: menu action “${action.kind}” failed:`, error));
  };

  return {
    controller,
    controlCenter,
    shared: {
      wifi: stores.wifi,
      devices: stores.devices,
      bluetooth: stores.bluetooth,
      sound: stores.sound,
      audio: stores.audio,
      ...(options.mixer ? { mixer: options.mixer } : {}),
      ...(pipewire ? { pipewire } : {}),
      // The popover is not up when Settings asks, so there is nothing to close first.
      askWifiPassword: (network) => stores.passwords.ask(network),
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
      stores.passwords.close();
      stores.pairing.dismiss();
    },
    close() {
      controller.close();
      stopSyncingCenter();
      dialogs.close();
      stores.passwords.close();
      stores.sound.close();
      stores.stopDevices();
      stores.pairing.close();
      options.wifi.backend.close();
      options.bluetooth.backend.close();
    },
  };
}
