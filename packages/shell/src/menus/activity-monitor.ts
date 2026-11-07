/**
 * Opening Activity Monitor at its Energy tab, with an app selected: the
 * battery menu's "Using significant energy" and its apps. A running Activity
 * Monitor comes forward and is handed the arguments over its menus channel
 * (app-menus/protocol.ts `open`); otherwise it starts with them on its
 * command line (apps/activity-monitor/args.ts reads both).
 */

import type { CompositorWindow } from "../compositor.ts";
import { windowToFront } from "../front-window.ts";

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
