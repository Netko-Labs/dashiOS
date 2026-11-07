/**
 * System Settings' Edit menu in the menu bar: Undo and Redo of a setting
 * changed (history.ts), ❖Z and ⇧❖Z. Settings runs in the shell, so it
 * publishes into the shell's own menu store, as the window's process: the
 * Metal host that draws it, found by the window's app id. The shell's ❖
 * chords then choose these rows as they would an app's (app-menus/). While a
 * field in the window has the keyboard (the host's `typing`, as the app kit
 * hands it on: apps/kit/typing.ts) the menu says so, and ❖Z and ⇧❖Z are the
 * field's, as ❖A ❖C ❖X ❖V are (KB-6).
 */

import { type UndoStack, undoMenuItems } from "@dashi/ui";
import { type AppMenu, parseMenus } from "../app-menus/protocol.ts";
import type { MenuOwner } from "../app-menus/store.ts";

export interface MenuHost {
  publish(owner: MenuOwner, menus: readonly AppMenu[], typing?: boolean): void;
  withdraw(owner: MenuOwner): void;
}

/** Tries to find the window's process this many times, this far apart, while it opens. */
const LOOKS = 20;
const LOOK_MS = 150;

/** The Edit menu for `undo`'s state. */
export function editMenu(undo: UndoStack): AppMenu[] {
  const menus = parseMenus([{ id: "edit", items: undoMenuItems(undo.state) }]);
  return "error" in menus ? [] : menus;
}

/** The published Edit menu. */
export interface EditMenu {
  /** A field in the window took the keyboard (true), or the last one let it go. */
  setTyping(typing: boolean): void;
  /** Takes the menu down. */
  stop(): void;
}

/**
 * Publishes the Edit menu as `pid`'s (asked for until the window is there),
 * kept current with `undo` and with whether a field has the keyboard.
 */
export function publishEditMenu(
  host: MenuHost,
  undo: UndoStack,
  pid: () => Promise<number | null>,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): EditMenu {
  let owner: MenuOwner | null = null;
  let stopped = false;
  let typing = false;
  const publish = (): void => {
    if (owner) host.publish(owner, editMenu(undo), typing);
  };
  const step = (way: "undo" | "redo"): void => {
    void (way === "undo" ? undo.undo() : undo.redo()).catch((error) => console.error(`dashi-shell: Settings could not ${way}:`, error));
  };
  const stopListening = undo.subscribe(publish);
  void (async () => {
    for (let look = 0; look < LOOKS && !stopped; look++) {
      const found = await pid().catch(() => null);
      if (found !== null && !stopped) {
        owner = {
          pid: found,
          send: (message) => {
            if (message.type === "select" && (message.id === "undo" || message.id === "redo")) step(message.id);
          },
        };
        publish();
        return;
      }
      await sleep(LOOK_MS);
    }
  })();
  return {
    setTyping(now) {
      if (now === typing) return;
      typing = now;
      publish();
    },
    stop() {
      stopped = true;
      stopListening();
      if (owner) host.withdraw(owner);
      owner = null;
    },
  };
}
