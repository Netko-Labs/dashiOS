/**
 * What speaks to the person through notifications (main.tsx): the banners
 * themselves, "Show in folder", low-battery warnings, Calendar's alerts, the
 * daily look for updates; and Control Center's switches that follow them (Do
 * Not Disturb, Night Shift, Dark Mode).
 */

import { activeScreen } from "../active-screen.ts";
import { startAppearance } from "../appearance/follow.ts";
import { launch, ownApp } from "../apps.ts";
import { type CalendarService, startCalendar } from "../calendar/service.ts";
import type { Compositor } from "../compositor.ts";
import { controlFlags } from "../control-center/index.ts";
import type { DockPrefs } from "../dock/index.ts";
import { type FileManagerService, filesLaunch, serveFileManager } from "../file-manager.ts";
import { startNightShift } from "../night-shift.ts";
import { type Notifications, startNotifications } from "../notifications/index.ts";
import type { SettingsStore } from "../settings-app/index.ts";
import type { RegistryStores } from "../settings-app/registry/index.ts";
import type { FlagsStore } from "../shared/control-center/flags.ts";
import { Software } from "../shared/software/manager.ts";
import { standIn } from "../shared/software/stand-in.ts";
import { checkPath, openSoftwareUpdates, UpdateCheck } from "../software/update-check.ts";
import { BatteryAlerts } from "../system/battery-alerts.ts";
import type { System } from "../system/start.ts";
import type { ToplevelStore } from "../toplevels.ts";
import type { Look } from "./look.ts";
import type { LateParts } from "./parts.ts";
import type { Late, Services } from "./services.ts";

export interface Notices {
  fileManager: Promise<FileManagerService | null>;
  notifications: Notifications;
}

/** "Show in folder", and the notifications themselves. */
export function startNotices(compositor: Compositor | null, services: Services): Notices {
  // Notifications: org.freedesktop.Notifications on the session bus, with banners
  // at the top right. If the bus is missing or the name is taken, it logs and
  // the shell goes on without.
  // "Show in folder" from browsers and other apps (org.freedesktop.FileManager1): Dashi's Files answers.
  const fileManager = serveFileManager((args, startup) => {
    const files = filesLaunch(ownApp("dev.dashi.files"), args, startup);
    if (files) launch(files);
  });
  services.add("file manager", () => void fileManager.then((service) => service?.close()));
  const notifications = startNotifications(undefined, { screen: () => (compositor ? activeScreen(compositor) : Promise.resolve(undefined)) });
  services.add("notifications", () => notifications.close());
  return { fileManager, notifications };
}

type SystemState = ReturnType<System["store"]["getSnapshot"]>;

/** Whether the daily look for updates may run now: online, and on a charger or with no battery. */
export function mayLookForUpdates({ battery, network }: Pick<SystemState, "battery" | "network">): boolean {
  return network?.kind !== "offline" && battery?.state !== "discharging";
}

interface SpokenNeeds {
  notifications: Notifications;
  toplevels: ToplevelStore;
  system: System;
  developmentRun: boolean;
  services: Services;
  late: Late<LateParts>;
}

/** Low-battery warnings, Calendar's alerts and the daily look for updates, all told in notifications. */
export function startSpoken({ notifications, toplevels, system, developmentRun, services, late }: SpokenNeeds): CalendarService {
  // Low-battery warnings go through that store (system/battery-alerts.ts).
  services.add("battery alerts", new BatteryAlerts(notifications.store).start());
  // Calendar's alerts fire from here, window open or not; the notification center's month marks the days with
  // events and opens the app on one (calendar/). A development run keeps what has fired in memory, not in the state folder.
  const calendar = startCalendar({ notifications: notifications.store, toplevels, ...(developmentRun ? { statePath: null } : {}) });
  services.add("calendar", () => calendar.close());
  // The daily look for app and system updates, told in one quiet notification; it installs nothing (software/update-check.ts).
  const stopUpdateCheck = new UpdateCheck({
    software: new Software(standIn() ?? {}),
    notifications: notifications.store,
    open: () =>
      openSoftwareUpdates({
        windows: () => toplevels.getSnapshot(),
        activate: (id) => toplevels.act(id, "activate"),
        openWith: (appId, env) => late.get("openWith")(appId, env),
      }),
    canLook: () => mayLookForUpdates(system.store.getSnapshot()),
    statePath: developmentRun ? null : checkPath(),
  }).start();
  services.add("update check", stopUpdateCheck);
  return calendar;
}

export interface Switches {
  /** Do Not Disturb, Dark Mode, Night Shift: Control Center's switches. */
  flags: FlagsStore;
  /** The settings registry's rows read and change through these (settings-app/registry/): the launcher's, links', and agents'. */
  registryStores: RegistryStores;
}

/** Control Center's switches, and what follows them: the banners, Night Shift, Dark Mode for apps and the window chrome. */
export function startSwitches(
  compositor: Compositor | null,
  { settingsStore, dockPrefs, notifications, look }: { settingsStore: SettingsStore; dockPrefs: DockPrefs; notifications: Notifications; look: Look },
  services: Services,
): Switches {
  // Do Not Disturb is Control Center's switch; the store holds banners while it's on.
  const flags = controlFlags();
  const registryStores: RegistryStores = { settings: settingsStore, flags, dock: dockPrefs };
  const followFlags = () => notifications.store.setDoNotDisturb(flags.getSnapshot().dnd);
  followFlags();
  services.add("flags", flags.subscribe(followFlags));
  // Night Shift warms the screens when its switch is on (night-shift.ts).
  services.add("night shift", compositor ? startNightShift(compositor, flags) : () => {});
  // Dark Mode repaints the shell by itself (theme.ts); apps are told here (appearance/).
  services.add("appearance", startAppearance(flags, { ...look.appearanceDeps, corners: look.gtkCorners }));
  // The compositor's title bars and the windows' depth follow Dark Mode too (IPC `chrome`, `window-style`).
  const tellChrome = () => {
    const { dark } = flags.getSnapshot();
    look.chromeStyle?.setDark(dark);
    look.windowStyle?.set({ dark });
  };
  tellChrome();
  services.add("chrome", flags.subscribe(tellChrome));
  return { flags, registryStores };
}
