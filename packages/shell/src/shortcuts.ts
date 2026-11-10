/**
 * What the keymap's bindings and ❖ itself do (keymap.ts says which chords).
 * The compositor reports them over IPC; these are the shell's actions,
 * carried out through the same IPC. A binding that is a `dashi://` address
 * is an action of the registry (actions/, docs/actions.md), run for the
 * person on the focused window: binding a key to anything the registry
 * holds is one rule in keymap.ts. The other names are the older closed list
 * below, moving to addresses one kind at a time; the hardware keys' names
 * (volume, brightness, media) are system/keys.ts's.
 */

import { chordText, type PressedChord } from "./app-menus/shortcut.ts";
import type { Compositor, CompositorWindow } from "./compositor.ts";
import { takeScreenshot } from "./screenshots/index.ts";
import type { SwitcherController } from "./switcher/index.ts";
import type { HardwareKeys } from "./system/keys.ts";

export interface ShellActions {
  toggleLauncher(): void;
  showSheet(): void;
  hideSheet(): void;
  switcher: SwitcherController;
  /** A binding that is a `dashi://` address: the registry runs it for the person, on `window` (actions/start.ts). */
  runAddress?(address: string, window: number | null): Promise<void>;
  /** Volume, brightness, and media keys (system/keys.ts). */
  hardware: Pick<HardwareKeys, "run">;
  /** Lock the screen (lock/). */
  lock(): void;
  /** The power key was pressed (power/). */
  powerKey(): void;
  /** Opens Force Quit Applications (force-quit/). */
  forceQuit(): void;
  /** Opens System Settings (settings-app/), on ❖, as on the Mac. */
  settings?(): void;
  /** Turns Dock autohide on or off (dock/prefs.ts), on ⌥❖D, as on the Mac. */
  toggleAutohide?(): void;
  /** ⌃F2: the keyboard to the menu bar, or back from it (menus/bar-keys.ts). */
  menuBar?(): void;
  /** Mission Control: all windows at once (overview/). */
  overview: { toggle(): void };
  /** Chooses the item of `window`'s app menus that shows `shortcut` ("⇧❖N", app-menus/); false when none does. */
  appShortcut?(window: number, shortcut: string): Promise<boolean>;
  /** Tells the app of the window owned by `pid` that it is quitting, before its close request (app-menus/, kit/close.ts). */
  appQuitting?(pid: number | null): void;
  /** Spaces: ⌃← ⌃→ and ⌃1…⌃9 (spaces/); says whether the binding was one of its keys. */
  spaces?: { binding(name: string): boolean };
  /**
   * The open launcher's keys: ⌃N ⌃P, Page Up and Down, Home and End (launcher/keys.ts), and what is
   * typed before its field has the keyboard, with its text (launcher/type-ahead.ts); says whether it was one.
   */
  launcher?: { binding(name: string, chord?: PressedChord, text?: string): boolean };
  /**
   * Whether the screen is locked (lock/). Then no ❖ tap or hold and no
   * binding acts: the compositor sends none while locked, and one already on
   * its way when the screen locked must not open the launcher or a sheet, or
   * type into a window, behind the lock screen.
   */
  isLocked?(): boolean;
}

/** The binding that opens and closes the launcher (keymap.ts). */
const LAUNCHER = "launcher";

/** What a binding that is an action's address starts with (actions/address.ts `SCHEME`). */
const ADDRESS = "dashi://";

/** The compositor client's requests the actions use. */
export type Requests = Pick<Compositor, "sendKeys" | "close" | "minimize" | "hide" | "focus" | "capture" | "windows">;

/**
 * Windows of one app: the same app id, so separate processes of one app
 * (each terminal window is its own foot) count as one, as on a Mac; one
 * process when either window has no app id.
 */
export function sameApp(a: CompositorWindow, b: CompositorWindow): boolean {
  if (a.appId && b.appId) return a.appId === b.appId;
  return a.pid !== null && a.pid === b.pid;
}

/** ❖ and a chord in one of Dashi's own apps: its menu item with that shortcut, as on a Mac; else the app's Ctrl chord, as ❖ chords go everywhere else (keymap.ts). */
async function appChord(window: number | null, compositor: Requests, actions: ShellActions, chord?: PressedChord): Promise<void> {
  if (window === null || !chord) return;
  const shortcut = chordText(chord);
  if (shortcut && (await actions.appShortcut?.(window, shortcut))) return;
  await compositor.sendKeys({ window, chord: `ctrl+${chord.shift ? "shift+" : ""}${chord.key}` });
}

/**
 * ❖⌫ in one of Dashi's own apps: its row that shows ❖⌫ (Files' Move to
 * Trash) unless a field is typing; else what ❖⌫ does in text anywhere,
 * erasing to the line's start (keymap.ts).
 */
async function appErase(window: number | null, compositor: Requests, actions: ShellActions): Promise<void> {
  if (window === null) return;
  if (await actions.appShortcut?.(window, "❖⌫")) return;
  await compositor.sendKeys({ window, chord: "shift+Home" });
  await compositor.sendKeys({ window, chord: "BackSpace" });
}

/** ❖Q: every window of the app is asked to close. */
async function quitApp(window: number, compositor: Requests, actions: ShellActions): Promise<void> {
  const windows = await compositor.windows();
  const focused = windows.find((candidate) => candidate.id === window);
  if (!focused) return;
  for (const each of windows.filter((candidate) => sameApp(candidate, focused))) {
    // A question it asks names quitting ("Quit Terminal?"), not closing a window.
    actions.appQuitting?.(each.pid);
    await compositor.close({ window: each.id });
  }
}

/** ❖`: the app's back-most other window comes forward. */
async function nextWindow(window: number, compositor: Requests): Promise<void> {
  const windows = await compositor.windows();
  const focused = windows.find((candidate) => candidate.id === window);
  if (!focused) return;
  const back = windows.filter((candidate) => candidate.id !== window && candidate.state === "normal" && sameApp(candidate, focused)).at(-1);
  if (back) await compositor.focus({ window: back.id });
}

/** The bindings that act on the focused window. */
async function windowBinding(name: string, window: number, compositor: Requests, actions: ShellActions, chord?: PressedChord): Promise<void> {
  switch (name) {
    case "close-window":
      // ❖W in one of Dashi's own apps: its own ❖W row first (Terminal's
      // Close Tab, Text Editor's Close), as any other ❖ chord there; ⇧❖W its
      // ⇧❖W row (Terminal's Close Window). The window closes when it has none.
      if (await actions.appShortcut?.(window, chord?.shift ? "⇧❖W" : "❖W")) return;
      await compositor.close({ window });
      return;
    case "minimize-window":
      await compositor.minimize({ window });
      return;
    case "hide-app":
      await compositor.hide({ window });
      return;
    case "screenshot-window":
      await takeScreenshot(compositor, { window });
      return;
    case "quit-app":
      return quitApp(window, compositor, actions);
    case "next-window":
      return nextWindow(window, compositor);
    default:
      console.error(`dashi-shell: the keymap binds “${name}”, but no action has that name`);
  }
}

/** Run a binding; `window` is the window focused when it was pressed. */
export async function runBinding(name: string, window: number | null, compositor: Requests, actions: ShellActions, chord?: PressedChord): Promise<void> {
  // An address: the action registry's, whatever it is (arranging windows is bound so: keymap.ts).
  if (name.startsWith(ADDRESS)) return actions.runAddress?.(name, window);
  // The hardware keys act on the system, whatever window has focus.
  if (await actions.hardware.run(name)) return;
  if (actions.spaces?.binding(name)) return;
  // Bound only while the launcher is open (launcher/keys.ts LAUNCHER_RULES).
  if (actions.launcher?.binding(name, chord)) return;
  // Bound only while the switcher is open (keymap.ts SWITCHER_RULES).
  if (name.startsWith("switcher-")) return switcherBinding(name, chord?.key, actions.switcher);
  switch (name) {
    case "app-chord":
      return appChord(window, compositor, actions, chord);
    case "app-erase":
      return appErase(window, compositor, actions);
    case LAUNCHER:
      return actions.toggleLauncher();
    case "switch-next":
      return actions.switcher.step("next");
    case "switch-previous":
      return actions.switcher.step("previous");
    case "switch-cancel":
      return actions.switcher.cancel();
    case "lock-screen":
      return actions.lock();
    case "power-key":
      return actions.powerKey();
    case "force-quit":
      return actions.forceQuit();
    case "settings":
      return actions.settings?.();
    case "toggle-autohide":
      return actions.toggleAutohide?.();
    case "overview":
      return actions.overview.toggle();
    case "menu-bar":
      return actions.menuBar?.();
  }
  // The rest act on the focused window, if there is one.
  if (window === null) return;
  return windowBinding(name, window, compositor, actions, chord);
}

/** A switcher session's key: a step, ⌫, or a key typed (or acted on). */
function switcherBinding(name: string, key: string | undefined, switcher: SwitcherController): void {
  switch (name) {
    case "switcher-down":
      return switcher.step("down");
    case "switcher-up":
      return switcher.step("up");
    case "switcher-left":
      return switcher.step("left");
    case "switcher-right":
      return switcher.step("right");
    case "switcher-erase":
      return switcher.erase();
    case "switcher-key":
      if (key) switcher.type(key);
      return;
  }
}

/** ❖ alone: a tap, a hold, a chord begun or its release. */
function superPhase(phase: "tap" | "hold" | "chord" | "up", actions: ShellActions): void {
  switch (phase) {
    case "tap":
      actions.toggleLauncher();
      break;
    case "hold":
      actions.showSheet();
      break;
    case "chord":
      actions.hideSheet();
      break;
    case "up":
      actions.hideSheet();
      actions.switcher.commit();
      break;
  }
}

export function startShortcuts(compositor: Requests & Pick<Compositor, "on">, actions: ShellActions): () => void {
  return compositor.on((event) => {
    if (event.event === "super") {
      // Locked: a tap or a hold shows nothing; a chord or ❖ coming up still takes the sheet down.
      if (actions.isLocked?.() && (event.phase === "tap" || event.phase === "hold")) return;
      superPhase(event.phase, actions);
    } else if (event.event === "binding") {
      if (actions.isLocked?.()) return;
      // The launcher's keys are taken here, in the order they came: typing must not be reordered.
      if (event.name.startsWith("launcher-") && actions.launcher?.binding(event.name, event.chord, event.text)) return;
      // ❖Space opens it here too, before the next event: the keys typed after it (armsAfterTap,
      // launcher/type-ahead.ts) can come in the same breath, and must find it opening.
      if (event.name === LAUNCHER) return actions.toggleLauncher();
      runBinding(event.name, event.window, compositor, actions, event.chord).catch((error) => console.error(`dashi-shell: “${event.name}” failed:`, error));
    }
  });
}
