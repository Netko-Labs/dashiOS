/**
 * Opens Force Quit Applications on demand (the Dashi menu, ⌥❖Esc) and keeps
 * its list current while it is open: windows opening and closing refresh it,
 * and the session locking closes it. Only one window is ever open. It also
 * answers for agents (`apps`, `end`), so one place owns what may be signalled.
 */

import { displayName } from "../apps.ts";
import type { Compositor, CompositorEvent, CompositorWindow } from "../compositor/index.ts";
import { type Entry, loadEntries } from "../entries.ts";
import { findEntry } from "../menus/index.ts";
import { type OverlayHandle, openOverlay } from "../overlay.tsx";
import { iconPath } from "../shared/apps/index.ts";
import { isAlive, protectedPids, readProcStat, sendSignal } from "../shared/processes/kernel.ts";
import { type Outcome, terminate } from "../shared/processes/policy.ts";
import { ForceQuitController } from "./lib/controller.ts";
import { appGroups, type Identity } from "./lib/model.ts";
import { FORCE_QUIT, ForceQuitWindow } from "./lib/view.tsx";
import type { AppGroup } from "./types.ts";

export interface ForceQuit {
  open(): void;
  close(): void;
  /** The apps the window would list for these windows: one per process, the shell's own left out. */
  apps(windows: readonly CompositorWindow[]): AppGroup[];
  /** Ends `pid` as the window's button does; nothing is sent for a process the window would not list. */
  end(pid: number, windows: readonly CompositorWindow[]): Outcome;
}

/** A window's name and icon: the installed app's, else the app id's name and a stand-in icon. */
export function identifierFor(entries: readonly Entry[]): (window: CompositorWindow) => Identity {
  return (window) => {
    const entry = findEntry(entries, window.appId);
    return entry ? { name: entry.name, icon: entry.icon } : { name: displayName(window.appId, window.title), icon: iconPath("generic") };
  };
}

interface Session {
  controller: ForceQuitController;
  surface: OverlayHandle | null;
  unsubscribe: () => void;
}

export function startForceQuit(compositor: Compositor | null): ForceQuit {
  // The shell's own process and its parents are never listed or signalled; they do not change while it runs.
  const protectedSet = protectedPids(process.pid, readProcStat);
  let session: Session | null = null;

  const close = (): void => {
    const current = session;
    if (!current) return;
    session = null;
    current.unsubscribe();
    current.surface?.close();
  };

  const open = (): void => {
    if (session) {
      void session.controller.refresh();
      return;
    }
    const identify = identifierFor(loadEntries());
    const controller = new ForceQuitController({
      windows: async () => (compositor ? compositor.windows() : []),
      identify,
      protectedPids: protectedSet,
      signal: sendSignal,
      alive: isAlive,
      later: (ms, run) => void setTimeout(run, ms),
      close,
    });
    const current: Session = { controller, surface: null, unsubscribe: () => {} };
    session = current;
    current.surface = openOverlay(
      {
        title: "Force Quit Applications",
        width: FORCE_QUIT.width,
        height: FORCE_QUIT.height,
        surface: { layer: "overlay", keyboard: "exclusive", namespace: "dashi.forcequit" },
      },
      <ForceQuitWindow controller={controller} />,
      () => {
        // The surface went by itself (its host died): forget the session, do not close it again.
        if (session === current) session = null;
        current.unsubscribe();
      },
    );
    current.unsubscribe = compositor
      ? compositor.on((event: CompositorEvent) => {
          if (event.event === "window-opened" || event.event === "window-closed") void controller.refresh();
          else if (event.event === "lock" && event.locked) close();
        })
      : () => {};
    void controller.refresh();
  };

  const apps = (windows: readonly CompositorWindow[]): AppGroup[] => appGroups(windows, protectedSet, identifierFor(loadEntries()));

  const end = (pid: number, windows: readonly CompositorWindow[]): Outcome =>
    terminate(pid, {
      listed: new Set(windows.flatMap((window) => (window.pid === null ? [] : [window.pid]))),
      protected: protectedSet,
      signal: sendSignal,
      alive: isAlive,
      later: (ms, run) => void setTimeout(run, ms),
    });

  return { open, close, apps, end };
}
