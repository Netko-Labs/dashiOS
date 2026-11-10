/**
 * What the launcher lists besides the apps, kept current while it is open:
 * the registry's actions the person may use (actions/), and the open
 * windows named as the switcher names them (switcher/model.ts groups them:
 * most recent app first, each app's windows front to back). One snapshot
 * for React; a new one when the registry, the windows, or a setting's state
 * changes (a switch flipped from Control Center flips in the row).
 */

import type { ActionDef } from "../actions/index.ts";
import type { CompositorWindow } from "../compositor.ts";
import { spaceLabel } from "../spaces/index.ts";
import { groupByApp } from "../switcher/model.ts";
import { type LauncherWindow, windowAddress } from "./lib/items.ts";

export interface WorldDeps {
  /** The registry's actions for the person (`registry.list({ who: "person" })`), and hearing it change. */
  actions(): readonly ActionDef[];
  onActions(listener: () => void): () => void;
  windows(): Promise<readonly CompositorWindow[]>;
  /** Hear that windows came, went, or changed. */
  onWindows?(listener: () => void): () => void;
  /** The installed app a window belongs to: its entry's id, name and icon (the Dock's names). */
  appOf(window: CompositorWindow): { entryId: string | null; name: string; icon: string };
  /** The Desktop a window is on, when that is not the one showing ("Desktop 2"). */
  desktopOf?(window: CompositorWindow): string | undefined;
  /** Hear that a setting's state changed (the Control Center stores). */
  onState?(listener: () => void): () => void;
}

export interface WorldSnapshot {
  actions: readonly ActionDef[];
  windows: readonly LauncherWindow[];
  /** Bumped when only a state changed: the rows redraw, the index stays. */
  serial: number;
}

/**
 * What a window row calls the Desktop a window is on: its name, unless the
 * name only repeats the window's app (a Desktop auto-named "Terminal"), then
 * its place ("Desktop 2"), so the row never reads "Terminal · Terminal".
 */
export function desktopWord(label: string | undefined, appName: string, index: number): string {
  const same = label !== undefined && label.trim().toLocaleLowerCase() === appName.trim().toLocaleLowerCase();
  return label && !same ? label : spaceLabel(index);
}

/** The shell's own surfaces are not windows to switch to. */
const SHELL_APP_ID = "dev.dashi.shell";

/** The compositor's windows as the launcher lists them, in the switcher's order. */
export function launcherWindows(windows: readonly CompositorWindow[], deps: Pick<WorldDeps, "appOf" | "desktopOf">): LauncherWindow[] {
  return groupByApp(windows.filter((window) => window.appId !== SHELL_APP_ID)).flatMap((group) =>
    group.windows.map((window): LauncherWindow => {
      const app = deps.appOf(window);
      const desktop = deps.desktopOf?.(window);
      return {
        id: window.id,
        address: windowAddress(window.id),
        title: window.title,
        appName: app.name,
        entryId: app.entryId,
        state: window.state,
        icon: app.icon,
        ...(desktop ? { desktop } : {}),
      };
    }),
  );
}

export class LauncherWorld {
  private snapshot: WorldSnapshot;
  private readonly listeners = new Set<() => void>();
  private readonly offs: Array<() => void> = [];
  private reads = 0;

  constructor(private readonly deps: WorldDeps) {
    this.snapshot = { actions: deps.actions(), windows: [], serial: 0 };
    this.offs.push(deps.onActions(() => this.publish({ actions: deps.actions() })));
    if (deps.onWindows) this.offs.push(deps.onWindows(() => void this.refresh()));
    if (deps.onState) this.offs.push(deps.onState(() => this.publish({})));
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): WorldSnapshot => this.snapshot;

  /** Read the windows again (the launcher opening); a later read wins over one still on its way. */
  async refresh(): Promise<void> {
    const read = ++this.reads;
    const windows = await this.deps.windows().catch(() => []);
    if (read !== this.reads) return;
    this.publish({ windows: launcherWindows(windows, this.deps) });
  }

  private publish(change: Partial<Omit<WorldSnapshot, "serial">>): void {
    this.snapshot = { ...this.snapshot, ...change, serial: this.snapshot.serial + 1 };
    for (const listener of this.listeners) listener();
  }

  close(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
  }
}
