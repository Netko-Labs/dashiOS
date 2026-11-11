/**
 * What the Dock does when told to: a click on an icon, and the rows of an
 * icon's menu (menu.ts). It also remembers which apps were just started and
 * have not opened a window yet, so their dot shows right away.
 */

import type { Toplevel } from "@mirinjs/metal";
import { useSyncExternalStore } from "react";
import { clickAction } from "../apps.ts";
import type { Compositor } from "../compositor/index.ts";
import type { Entry } from "../shared/app-entries/index.ts";
import type { App } from "../shared/apps/index.ts";
import type { ToplevelStore } from "../toplevels.ts";
import { appKey, type DockEntry } from "./layout.ts";
import { type TaskbarButton, taskbarClick } from "./lib/taskbar-model.ts";
import type { PinStore } from "./pins.ts";
import type { DockPrefs } from "./prefs.ts";
import type { DockMenuAction } from "./types.ts";

/** How long a started app shows its dot before a window appears. */
const LAUNCH_GRACE_MS = 15_000;

export interface DockControllerDeps {
  catalog: readonly Entry[];
  pins: Pick<PinStore, "pin" | "unpin">;
  toplevels: Pick<ToplevelStore, "act" | "getSnapshot" | "subscribe">;
  /** Null without dashi-comp: Hide does nothing. */
  compositor: Pick<Compositor, "hide" | "close" | "windows"> | null;
  /** Starts the app; its pid, or null when it could not be started. */
  launch(app: App): number | null;
  /** The Dock's settings: its menu changes them. Without it those rows do nothing. */
  prefs?: Pick<DockPrefs, "set">;
  /** Opens System Settings on the Desktop & Dock pane. */
  openDockSettings?(): void;
  /** A click on an icon is about to bring something forward (Mission Control leaves). */
  onPress?(): void;
  /** An app was opened or brought forward from the Dock: the launcher's ranking counts it (launcher/ranking/). */
  opened?(appId: string): void;
  /**
   * Quit is about to ask a window of process `pid` to close: its app hears it
   * quits first (app-menus, kit/close.ts), so a question it asks is the app's
   * ("Quit Terminal?"), not the close control's ("Close this window?").
   */
  appQuitting?(pid: number | null): void;
  graceMs?: number;
}

export class DockController {
  private starting: ReadonlySet<string> = new Set();
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private readonly listeners = new Set<() => void>();
  private readonly stopWatching: () => void;
  private readonly graceMs: number;

  constructor(private readonly deps: DockControllerDeps) {
    this.graceMs = deps.graceMs ?? LAUNCH_GRACE_MS;
    this.stopWatching = deps.toplevels.subscribe(() => this.opened(deps.toplevels.getSnapshot()));
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** The keys of apps that were started and have no window yet. */
  getSnapshot = (): ReadonlySet<string> => this.starting;

  /** A click on an icon: start the app, bring its window forward, or restore a minimized one. */
  press(entry: DockEntry): void {
    this.deps.onPress?.();
    const action = clickAction(entry);
    if (action.kind === "activate") {
      this.deps.toplevels.act(action.id, "activate");
      this.deps.opened?.(entry.app.id);
    }
    if (action.kind === "launch") this.open(entry.app);
  }

  /** A click on a taskbar button (taskbar-model.ts: Windows' rule). */
  pressButton(button: TaskbarButton): void {
    this.deps.onPress?.();
    const action = taskbarClick(button);
    if (action.kind === "activate") {
      this.deps.toplevels.act(action.window, "activate");
      this.deps.opened?.(button.entry.app.id);
    }
    if (action.kind === "minimize") this.deps.toplevels.act(action.window, "minimize");
    if (action.kind === "launch") this.open(button.entry.app);
  }

  open(app: App): void {
    if (this.deps.launch(app) === null) return;
    this.deps.opened?.(app.id);
    this.setStarting(new Set(this.starting).add(app.id));
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      this.setStarting(new Set([...this.starting].filter((id) => id !== app.id)));
    }, this.graceMs);
    this.timers.add(timer);
  }

  /** A chosen row of an icon's menu. */
  async run(action: DockMenuAction): Promise<void> {
    const { deps } = this;
    switch (action.kind) {
      case "focus":
        return deps.toplevels.act(action.window, "activate");
      case "pin":
        return deps.pins.pin(action.appId);
      case "unpin":
        return deps.pins.unpin(action.appId);
      case "open": {
        const app = deps.catalog.find((entry) => entry.id === action.appId);
        if (app) this.open(app);
        return;
      }
      case "quit":
        return this.quit(action.key, action.windows);
      case "dock-prefs":
        return deps.prefs?.set(action.change);
      case "dock-settings":
        return deps.openDockSettings?.();
      case "hide": {
        // Hiding is the compositor's: one window of the app hides them all.
        const windows = await (deps.compositor?.windows() ?? Promise.resolve([]));
        const target = windows.find((window) => window.state === "normal" && appKey(deps.catalog, window) === action.key);
        if (target) await deps.compositor?.hide({ window: target.id });
        return;
      }
    }
  }

  /**
   * Quit: every window of the app is asked to close, as ❖Q does. The
   * compositor's own list is the one to go by: its windows carry their pids,
   * so each app hears it quits first (one window per Dashi app process). The
   * Dock's toplevel ids are another numbering (mirin's foreign-toplevel
   * handles), so they serve only when the compositor has none of the app's
   * windows to name (no dashi-comp, or windows without an app id).
   */
  private async quit(key: string, toplevels: readonly number[]): Promise<void> {
    const { deps } = this;
    const listed = await (deps.compositor?.windows() ?? Promise.resolve([])).catch(() => []);
    const windows = key.startsWith("window:") ? [] : listed.filter((window) => appKey(deps.catalog, window) === key);
    if (windows.length === 0) {
      for (const window of toplevels) {
        deps.appQuitting?.(null);
        deps.toplevels.act(window, "close");
      }
      return;
    }
    for (const window of windows) {
      deps.appQuitting?.(window.pid);
      await deps.compositor?.close({ window: window.id }).catch(() => {});
    }
  }

  close(): void {
    this.stopWatching();
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }

  /** Windows opened: the apps they belong to are no longer starting. */
  private opened(windows: readonly Toplevel[]): void {
    if (this.starting.size === 0) return;
    const open = new Set(windows.map((window) => appKey(this.deps.catalog, window)));
    const waiting = [...this.starting].filter((id) => !open.has(id));
    if (waiting.length !== this.starting.size) this.setStarting(new Set(waiting));
  }

  private setStarting(next: ReadonlySet<string>): void {
    this.starting = next;
    for (const listener of this.listeners) listener();
  }
}

export function useStarting(controller: DockController): ReadonlySet<string> {
  return useSyncExternalStore(controller.subscribe, controller.getSnapshot);
}
