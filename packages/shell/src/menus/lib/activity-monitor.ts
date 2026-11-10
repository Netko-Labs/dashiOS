/**
 * Opening Activity Monitor at its Energy tab, with an app selected: the
 * battery menu's "Using significant energy" and its apps. A running Activity
 * Monitor comes forward and is handed the arguments over its menus channel
 * (app-menus/protocol.ts `open`); otherwise it starts with them on its
 * command line (apps/activity-monitor/args.ts reads both).
 */

import { ownerPids } from "../../app-menus/focus.ts";
import type { AppMenuStore } from "../../app-menus/store.ts";
import type { Compositor, CompositorWindow } from "../../compositor.ts";
import { launchEntry } from "../../entries.ts";
import { windowToFront } from "../../front-window.ts";
import type { EntryFor } from "../options.ts";

export const ACTIVITY_MONITOR = "dev.dashi.activity-monitor";

/** The app to select: the battery monitor's key for it (a desktop entry's id) and its name. */
export interface EnergyApp {
  key: string;
  name: string;
}

/** The arguments that open the Energy tab, with `app` selected when given. */
export function energyArgs(app?: EnergyApp): string[] {
  return ["--tab", "energy", ...(app ? ["--app", app.key, "--app-name", app.name] : [])];
}

export interface OpenDeps {
  windows(): Promise<readonly CompositorWindow[]>;
  focus(window: number): Promise<unknown>;
  /** Hands the arguments to the app whose window is this process's (app-menus/store.ts `open` with focus.ts `ownerPids`). */
  handOver(pid: number, args: readonly string[]): boolean;
  /** Starts Activity Monitor with the arguments after its command line. */
  launch(args: readonly string[]): boolean;
}

/** Brings Activity Monitor forward and hands it `args`, or starts it with them. */
export async function openActivityMonitor(args: readonly string[], deps: OpenDeps): Promise<boolean> {
  const windows = (await deps.windows().catch(() => [])).filter((window) => window.appId === ACTIVITY_MONITOR && window.pid !== null);
  const front = windowToFront(windows);
  if (front?.pid != null && deps.handOver(front.pid, args)) {
    await deps.focus(front.id).catch(() => undefined);
    return true;
  }
  return deps.launch(args);
}

/** Opens the Energy tab for an app (the battery menu's rows), through the compositor and the app-menus channel. */
export function energyOpener(compositor: Compositor | null, appMenus: AppMenuStore, entryFor: EntryFor): (app?: EnergyApp) => Promise<boolean> {
  return (app) =>
    openActivityMonitor(energyArgs(app), {
      windows: () => compositor?.windows() ?? Promise.resolve([]),
      focus: (window) => compositor?.focus({ window }) ?? Promise.resolve(),
      handOver: (pid, args) => appMenus.open(ownerPids(pid), args),
      launch: (args) => {
        const entry = entryFor(ACTIVITY_MONITOR);
        return entry?.exec ? launchEntry({ ...entry, exec: [...entry.exec, ...args] }) !== null : false;
      },
    });
}
