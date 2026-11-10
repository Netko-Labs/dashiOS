/**
 * The session (main.tsx): the process's guards, the compositor, the screens,
 * settings.json and the clocks; and what happens once the bars are up (the
 * Setup Assistant at a first login, XDG autostart, the desktop entries).
 */

import { existsSync } from "node:fs";
import { linksEntry } from "../actions/index.ts";
import { activeScreen } from "../active-screen.ts";
import { startAutostart } from "../autostart.ts";
import { Compositor } from "../compositor.ts";
import { installDesktopEntries, shouldWriteEntries } from "../desktop-entries.ts";
import { monitorsOf } from "../display-config/index.ts";
import { screensOf } from "../displays.ts";
import { DockPrefs, resolveDock } from "../dock/index.ts";
import { idleKeymap } from "../keymap-state.ts";
import { LAUNCHER_MOTION } from "../launcher/resident.tsx";
import { chooseRegion, type RegionRuntime, startRegion } from "../region/index.ts";
import { SettingsStore } from "../settings-app/index.ts";
import { installedSpecs, METAL_HOST, shellDir } from "../shared/apps/index.ts";
import { connectDarkMode } from "../shared/control-center/flags.ts";
import { followSuspension } from "../suspend.ts";
import { ToplevelStore } from "../toplevels.ts";
import type { Services } from "./services.ts";

/** Errors that would end the process are logged instead, and the Metal host must be there. */
export function guardProcess(): void {
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
}

/** The compositor, or null when there is none (a run outside a Dashi session). */
export async function connectCompositor(): Promise<Compositor | null> {
  // The shell's logic runs here, in Bun; dashi-comp offers windows, captures,
  // and key events over its IPC, and matches keys against our keymap.
  const compositor = await Compositor.connect();
  // A shell outlives nothing: without its compositor it ends, so it never
  // reopens its surfaces on the next session's (which reuses the socket names).
  compositor?.onClosed(() => {
    console.error("dashi-shell: dashi-comp went away; the shell ends with it");
    process.exit(1);
  });
  // Windows off screen (minimized, hidden, on a Desktop not shown) are told no one sees them, so they can stop polling (suspend.ts).
  if (compositor) followSuspension(compositor);
  // Idle, the keymap also says what keys do from a ❖ tap on: they type into the launcher (launcher/type-ahead.ts).
  compositor?.keymap(idleKeymap()).catch((error) => console.error("dashi-shell: dashi-comp refused the keymap:", error));
  // The launcher fades in from a little smaller (launcher/resident.tsx); with Reduce Motion the compositor skips it.
  compositor
    ?.layerMotion({ namespace: LAUNCHER_MOTION.namespace, ms: LAUNCHER_MOTION.openMs, scale: LAUNCHER_MOTION.fromScale })
    .catch((error) => console.error("dashi-shell: dashi-comp refused the launcher's motion:", error));
  return compositor;
}

/**
 * The screens as the compositor says, for the menu bars (one on every screen, the Dock on the
 * primary one: menubars.ts), and where the person is.
 */
export class Screens {
  /** The main display Settings chose: the compositor's `primary` (display-config/); the bars follow it. */
  mainDisplay: string | null = null;

  constructor(private readonly compositor: Compositor | null) {}

  /** The screens, or null when the compositor could not say (nothing should be torn down on a failed question). */
  async names(): Promise<string[] | null> {
    if (!this.compositor) return [];
    try {
      const outputs = await this.compositor.outputs();
      this.mainDisplay = monitorsOf(outputs).find((monitor) => monitor.enabled && monitor.primary)?.name ?? null;
      return screensOf(outputs).map((screen) => screen.name);
    } catch {
      return null;
    }
  }

  /** The screen the person is on (pointer, else focused window): launcher, sheet, switcher, and banners open there. */
  whereIsPerson = (): Promise<string | undefined> => (this.compositor ? activeScreen(this.compositor) : Promise.resolve(undefined));
}

/** `{ output }` for a surface, or nothing for the compositor's choice. */
export function onScreen(output: string | undefined): { output?: string } {
  return output === undefined ? {} : { output };
}

export interface Stores {
  toplevels: ToplevelStore;
  settingsStore: SettingsStore;
  region: RegionRuntime;
  dockPrefs: DockPrefs;
}

/** The windows' store, settings.json, the clocks and the Dock's settings. */
export function startStores(services: Services): Stores {
  // The primary menu bar's host reports the windows (`shell.toplevels`); the store follows whichever host is up.
  const toplevels = new ToplevelStore();

  // settings.json, which System Settings writes (settings-app/store.ts); a scale
  // chosen there wins over each screen's default, from its pixel density (displays.ts).
  const settingsStore = new SettingsStore();
  services.add("recent settings changes", () => void settingsStore.changes.flush());
  // The menu bar follows `menuBar` in the file, so a hand edit shows without Settings being open.
  services.add("settings file watch", settingsStore.watch());
  // The Dock's settings (dock/prefs.ts): the file is the source of truth; they are applied from it at
  // startup and after every change, and a change made here (⌥❖D, the Dock's menu) is written to it.
  // The clocks and the time zone: timedated on a real session, a stand-in on a development run (region/select.ts).
  const regionSetup = chooseRegion();
  const region = startRegion({ settings: settingsStore, backend: regionSetup.backend });
  services.add("region", () => region.close());
  const dockPrefs = new DockPrefs((change) => settingsStore.patch("dock", change));
  settingsStore.subscribe(() => dockPrefs.apply(resolveDock(settingsStore.getSnapshot().data.dock)));
  return { toplevels, settingsStore, region, dockPrefs };
}

/** XDG autostart (autostart.ts) runs this long after the bars exist, so what it starts opens below the menu bar. */
const AUTOSTART_SETTLE_MS = 1000;

/** The Setup Assistant at a first login, the first-party apps' desktop entries, and XDG autostart, once the bars are up. */
export function startLogin(compositor: Compositor | null, setup: { openAtLogin(): void }, developmentRun: boolean, services: Services): void {
  // The Setup Assistant opens by itself at the first login, a moment after the bars exist.
  const setupTimer = setTimeout(() => {
    if (compositor) setup.openAtLogin();
  }, AUTOSTART_SETTLE_MS + 500);
  services.add("setup timer", () => clearTimeout(setupTimer));
  // Desktop entries for the first-party apps, so other launchers and `gio open` can start them (desktop-entries.ts).
  // Only in the person's own session: a development run would write the developer's applications folder.
  if (shouldWriteEntries(process.env, developmentRun)) {
    const entryContext = { bun: process.execPath, root: shellDir, host: METAL_HOST };
    // And the dashi:// handler beside them (actions/entry.ts).
    const links = linksEntry(entryContext);
    void installDesktopEntries(installedSpecs(), entryContext, links ? { extra: [links] } : {});
  }
  // XDG autostart, once per login session.
  let autostart: ReturnType<typeof startAutostart> | null = null;
  services.add("autostart", () => autostart?.close());
  const autostartTimer = setTimeout(() => {
    autostart = startAutostart({ developmentRun });
  }, AUTOSTART_SETTLE_MS);
  services.add("autostart timer", () => clearTimeout(autostartTimer));
}
