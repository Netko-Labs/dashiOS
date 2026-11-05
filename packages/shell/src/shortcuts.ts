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
import { takeScreenshot } from "./screenshots.ts";
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
  /** Drag out an area to capture; Space there takes `window` (screenshot-area.tsx). */
  screenshotArea(window: number | null): void;
  /** ⇧❖5: the screenshot and recording toolbar, or stop the recording (recorder/). */
  captureToolbar?(window: number | null): void;
  /** Opens Force Quit Applications (force-quit/). */
  forceQuit(): void;
  /** Opens System Settings (settings-app/), on ❖, as on the Mac. */
  settings?(): void;
  /** Turns Dock autohide on or off (dock/prefs.ts), on ⌥❖D, as on the Mac. */
  toggleAutohide?(): void;
  /** Mission Control: all windows at once (overview/). */
  overview: { toggle(): void };
  /** Chooses the item of `window`'s app menus that shows `shortcut` ("⇧❖N", app-menus/); false when none does. */
  appShortcut?(window: number, shortcut: string): Promise<boolean>;
  /** Spaces: ⌃← ⌃→ and ⌃1…⌃9 (spaces/); says whether the binding was one of its keys. */
  spaces?: { binding(name: string): boolean };
  /**
   * The open launcher's keys: ⌃N ⌃P, Page Up and Down, Home and End (launcher/keys.ts), and what is
   * typed before its field has the keyboard, with its text (launcher/type-ahead.ts); says whether it was one.
   */
  launcher?: { binding(name: string, chord?: PressedChord, text?: string): boolean };
}

/** What a binding that is an action's address starts with (actions/address.ts `SCHEME`). */
const ADDRESS = "dashi://";

/** The compositor client's requests the actions use. */
export type Requests = Pick<Compositor, "request" | "windows">;

/**
 * Windows of one app: the same app id, so separate processes of one app
 * (each terminal window is its own foot) count as one, as on a Mac; one
 * process when either window has no app id.
 */
export function sameApp(a: CompositorWindow, b: CompositorWindow): boolean {
  if (a.appId && b.appId) return a.appId === b.appId;
  return a.pid !== null && a.pid === b.pid;
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
    case "app-chord": {
      // A ❖ chord in one of Dashi's own apps: its menu item with that
      // shortcut, as on a Mac; else the app's Ctrl chord, as ❖ chords go
      // everywhere else (keymap.ts).
      if (window === null || !chord) return;
      const shortcut = chordText(chord);
      if (shortcut && (await actions.appShortcut?.(window, shortcut))) return;
      await compositor.request("send-keys", { window, chord: `ctrl+${chord.shift ? "shift+" : ""}${chord.key}` });
      return;
    }
    case "launcher":
      return actions.toggleLauncher();
    case "switch-next":
      return actions.switcher.step("next");
    case "switch-previous":
      return actions.switcher.step("previous");
    case "switch-cancel":
      return actions.switcher.cancel();
    case "screenshot-screen":
      await takeScreenshot(compositor);
      return;
    case "lock-screen":
      return actions.lock();
    case "power-key":
      return actions.powerKey();
    case "screenshot-area":
      return actions.screenshotArea(window);
    case "capture-toolbar":
      return actions.captureToolbar?.(window);
    case "force-quit":
      return actions.forceQuit();
    case "settings":
      return actions.settings?.();
    case "toggle-autohide":
      return actions.toggleAutohide?.();
    case "overview":
      return actions.overview.toggle();
  }
  // The rest act on the focused window, if there is one.
  if (window === null) return;
  switch (name) {
    case "close-window":
      // ❖W in one of Dashi's own apps: its own ❖W row first (Terminal's
      // Close Tab), as any other ❖ chord there; the window closes when it has none.
      if (await actions.appShortcut?.(window, "❖W")) return;
      await compositor.request("close", { window });
      return;
    case "minimize-window":
      await compositor.request("minimize", { window });
      return;
    case "hide-app":
      await compositor.request("hide", { window });
      return;
    case "screenshot-window":
      await takeScreenshot(compositor, { window });
      return;
    case "quit-app": {
      // ❖Q: every window of the app is asked to close.
      const windows = await compositor.windows();
      const focused = windows.find((candidate) => candidate.id === window);
      if (!focused) return;
      for (const each of windows.filter((candidate) => sameApp(candidate, focused))) {
        await compositor.request("close", { window: each.id });
      }
      return;
    }
    case "next-window": {
      // ❖`: the app's back-most other window comes forward.
      const windows = await compositor.windows();
      const focused = windows.find((candidate) => candidate.id === window);
      if (!focused) return;
      const back = windows.filter((candidate) => candidate.id !== window && candidate.state === "normal" && sameApp(candidate, focused)).at(-1);
      if (back) await compositor.request("focus", { window: back.id });
      return;
    }
    default:
      console.error(`dashi-shell: the keymap binds “${name}”, but no action has that name`);
  }
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

export function startShortcuts(compositor: Compositor, actions: ShellActions): () => void {
  return compositor.on((event) => {
    if (event.event === "super") {
      switch (event.phase) {
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
    } else if (event.event === "binding") {
      // The launcher's keys are taken here, in the order they came: typing must not be reordered.
      if (event.name.startsWith("launcher-") && actions.launcher?.binding(event.name, event.chord, event.text)) return;
      runBinding(event.name, event.window, compositor, actions, event.chord).catch((error) => console.error(`dashi-shell: “${event.name}” failed:`, error));
    }
  });
}
