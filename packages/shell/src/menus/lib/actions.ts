/**
 * What choosing a menu row does. The compositor's window actions go over
 * IPC, layout through the Arranger, and everything else (the lock screen,
 * sheets, power) is handed in, so this file holds only the policy: which
 * windows "Hide Others" hides, what "Quit" closes, and so on.
 *
 * Rows that stand for a keystroke in the app (Undo, Paste) type its chord
 * into the window (keystrokes.ts) once the menu is gone and the window has
 * the keyboard back.
 */

import type { Compositor, CompositorWindow } from "../../compositor/index.ts";
import type { Arrange } from "../../layout.ts";
import { sameApp } from "../../shortcuts.ts";
import type { EditCommand, MenuAction, PowerKind } from "../types.ts";
import { editChord } from "./keystrokes.ts";

/** What the actions reach beyond the compositor. */
export interface ActionDeps {
  /** Null without dashi-comp: window rows do nothing. */
  compositor: Pick<Compositor, "focus" | "hide" | "close" | "minimize" | "sendKeys" | "windows"> | null;
  arranger: {
    arrange(window: number, to: Arrange): Promise<void>;
    toggleFullscreen?(window: number): Promise<void>;
  } | null;
  /** Waits before typing into the window, so the menu's surface has let go of the keyboard; tests pass none. */
  settle?(): Promise<void>;
  lock(): void;
  /** Starts the app again; false when it cannot be. */
  launchApp(appId: string): boolean;
  showAbout(about: AboutTarget): void;
  /** Asks first; the answer runs the power action (session.ts). */
  confirmPower(what: PowerKind): void;
  suspend(): void;
  openHelp(): void;
  showShortcuts(): void;
  /** Opens Force Quit Applications (force-quit/). */
  openForceQuit(): void;
  /** Opens System Settings (settings-app/); a run without it does nothing. */
  openSettings?(): void;
  /** Opens the launcher (the Dashi menu's Search…); a run without it does nothing. */
  openSearch?(): void;
  /** Tells an app its own row was chosen (app-menus/); a run without it does nothing. */
  selectAppItem?(pid: number, id: string): void;
  /** Tells the app owning a window of `pid` that it quits, before the window's close request (kit/close.ts). */
  appQuitting?(pid: number | null): void;
  /** Puts a window on a Desktop, or on a new one (spaces/); a run without Desktops does nothing. */
  moveToSpace?(window: number, space: number | "new"): Promise<void>;
}

export type AboutTarget = { kind: "dashi" } | { kind: "app"; appId: string; name: string; pid: number | null };

/** One window of each app among `windows`, in their order. */
export function onePerApp(windows: readonly CompositorWindow[]): CompositorWindow[] {
  const picked: CompositorWindow[] = [];
  for (const window of windows) {
    if (!picked.some((each) => sameApp(each, window))) picked.push(window);
  }
  return picked;
}

export async function runMenuAction(action: MenuAction, deps: ActionDeps): Promise<void> {
  const { compositor } = deps;
  const toWindow = async (method: "hide" | "close" | "minimize" | "focus", window: number) => {
    await compositor?.[method]({ window });
  };
  switch (action.kind) {
    case "about-dashi":
      return deps.showAbout({ kind: "dashi" });
    case "about-app":
      return deps.showAbout({ kind: "app", appId: action.appId, name: action.name, pid: action.pid });
    case "sleep":
      return deps.suspend();
    case "power":
      return deps.confirmPower(action.what);
    case "lock":
      return deps.lock();
    case "force-quit":
      return deps.openForceQuit();
    case "settings":
      return deps.openSettings?.();
    case "search":
      return deps.openSearch?.();
    case "help":
      return deps.openHelp();
    case "shortcuts":
      return deps.showShortcuts();
    case "app-item":
      return deps.selectAppItem?.(action.pid, action.id);
    case "new-window":
      deps.launchApp(action.appId);
      return;
    case "hide-app":
      return toWindow("hide", action.window);
    case "close-window":
      return toWindow("close", action.window);
    case "minimize":
      return toWindow("minimize", action.window);
    case "focus":
      return toWindow("focus", action.window);
    case "tile":
      await deps.arranger?.arrange(action.window, action.tile);
      return;
    case "move-to-space":
      await deps.moveToSpace?.(action.window, action.space);
      return;
    case "fullscreen":
      await deps.arranger?.toggleFullscreen?.(action.window);
      return;
    case "edit":
      return typeEdit(deps, action.window, action.command);
    case "quit-app":
      return forEachWindowOfApp(compositor, action.window, (window) => {
        // A question it asks names quitting ("Quit Terminal?"), not closing a window.
        deps.appQuitting?.(window.pid);
        return toWindow("close", window.id);
      });
    case "hide-others":
      return hideOthers(compositor, action.window);
    case "show-all":
      return showAll(compositor, action.window);
    case "bring-to-front":
      return bringToFront(compositor, action.window);
  }
}

/** How long the menu's surface is given to let go of the keyboard (it closes just before the action runs). */
export const SETTLE_MS = 60;

/** Gives the window the keyboard back, then types the chord an Edit row stands for. */
async function typeEdit(deps: ActionDeps, window: number, command: EditCommand): Promise<void> {
  const { compositor } = deps;
  if (!compositor) return;
  const target = (await compositor.windows()).find((candidate) => candidate.id === window);
  if (!target || target.state !== "normal") return;
  await compositor.focus({ window });
  await (deps.settle ?? (() => Bun.sleep(SETTLE_MS)))();
  await compositor.sendKeys({ window, chord: editChord(command, target.appId) });
}

async function forEachWindowOfApp(compositor: ActionDeps["compositor"], window: number, each: (window: CompositorWindow) => Promise<void>): Promise<void> {
  if (!compositor) return;
  const windows = await compositor.windows();
  const focused = windows.find((candidate) => candidate.id === window);
  if (!focused) return;
  for (const sibling of windows.filter((candidate) => sameApp(candidate, focused))) await each(sibling);
}

/** Hides every other app that is on screen; the app of `window` stays and keeps the focus. */
async function hideOthers(compositor: ActionDeps["compositor"], window: number): Promise<void> {
  if (!compositor) return;
  const windows = await compositor.windows();
  const keep = windows.find((candidate) => candidate.id === window);
  if (!keep) return;
  const others = onePerApp(windows.filter((candidate) => candidate.state === "normal" && !sameApp(candidate, keep)));
  for (const other of others) await compositor.hide({ window: other.id });
  await compositor.focus({ window });
}

/** Unhides every hidden app (focusing one of its windows does), then gives the focus back. */
async function showAll(compositor: ActionDeps["compositor"], window: number | null): Promise<void> {
  if (!compositor) return;
  const windows = await compositor.windows();
  for (const hidden of onePerApp(windows.filter((candidate) => candidate.state === "hidden"))) {
    await compositor.focus({ window: hidden.id });
  }
  if (window !== null && windows.some((candidate) => candidate.id === window)) await compositor.focus({ window });
}

/** Raises the app's windows that are on screen (back to front) and ends on `window`. */
async function bringToFront(compositor: ActionDeps["compositor"], window: number): Promise<void> {
  if (!compositor) return;
  const windows = await compositor.windows();
  const focused = windows.find((candidate) => candidate.id === window);
  if (!focused) return;
  // `windows` is front to back; raising from the back keeps their order.
  const mine = windows.filter((candidate) => candidate.state === "normal" && sameApp(candidate, focused)).reverse();
  for (const each of mine) if (each.id !== window) await compositor.focus({ window: each.id });
  await compositor.focus({ window });
}
