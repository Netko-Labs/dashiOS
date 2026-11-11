/**
 * The launcher's host in the shell (host.ts): its verbs carried out through
 * the action registry where it has the action (a window's
 * `dashi://window/w3`, a setting, a command: run as the person, logged as
 * "you"), and through the compositor, the Dock and gio for the rest.
 */

import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import type { Actions } from "../actions/index.ts";
import type { Compositor } from "../compositor/index.ts";
import type { Keymap } from "../keymap/keymap.ts";
import type { Entry } from "../shared/app-entries/index.ts";
import { isPaneId, type PaneId } from "../shared/settings/index.ts";
import type { LauncherHost } from "./host.ts";
import { isPane } from "./lib/items.ts";

export interface ShellHostDeps {
  compositor: Compositor | null;
  actions: Pick<Actions, "registry" | "run">;
  openSettings(pane: PaneId, row?: string): void;
  /** Start an entry (entries.ts `launchEntry`); its pid, or null. */
  launch(entry: Entry): number | null;
  /** The Desktop showing, from 0; null without Desktops. */
  currentSpace(): number | null;
  /** Open a file or folder in its default app. */
  openFile(url: string): void;
  pins: { isPinned(id: string): boolean; pin(id: string): void; unpin(id: string): void };
  keymap(): Keymap;
}

/** A desktop entry's own New Window action, when it has one ("new-window", "NewWindow"). */
const NEW_WINDOW = /^new-?window$/i;

/** A keymap binding in words: an address is its action's title, a name is said plainly ("quit-app" is "Quit app"). */
export function describeBinding(bind: string, title: (address: string) => string | undefined): string {
  if (bind.startsWith("dashi://")) return title(bind) ?? bind;
  const words = bind.replaceAll("-", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function shellLauncherHost(deps: ShellHostDeps): LauncherHost {
  const { compositor, actions } = deps;
  const logged = async (method: string, sent: Promise<unknown> | undefined) => {
    await sent?.catch((error) => console.error(`dashi-shell: the launcher's ${method}:`, error));
  };
  const focus = async (window: { id: number; address: string }) => {
    const action = actions.registry.get(window.address);
    if (action) {
      const outcome = await actions.run(action);
      if (outcome.ok) return;
    }
    await logged("focus", compositor?.focus({ window: window.id }));
  };
  return {
    run: (action, args) => actions.run(action, args),
    reveal: ({ pane, row }) => {
      if (isPaneId(pane)) deps.openSettings(pane, row);
    },
    focus,
    newWindow: (entry) => {
      const own = entry.actions?.find((action) => NEW_WINDOW.test(action.id));
      return deps.launch(own ? { ...entry, exec: own.exec } : entry) !== null;
    },
    bringHere: async (window) => {
      const space = deps.currentSpace();
      if (space !== null) await logged("space-move", compositor?.spaceMove({ window: window.id, space }));
      await focus(window);
    },
    minimize: (window) => logged("minimize", compositor?.minimize({ window: window.id })),
    close: (window) => logged("close", compositor?.close({ window: window.id })),
    quit: async (windows) => {
      for (const window of windows) await logged("close", compositor?.close({ window: window.id }));
    },
    showInFiles: (file) => deps.openFile(pathToFileURL(dirname(file.path)).href),
    trash: async (file) => {
      try {
        const child = Bun.spawn(["gio", "trash", "--", file.path], { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
        return (await child.exited) === 0;
      } catch {
        return false;
      }
    },
    pinned: (entry) => (entry.hidden || isPane(entry) ? null : deps.pins.isPinned(entry.id)),
    pin: (entry, pin) => (pin ? deps.pins.pin(entry.id) : deps.pins.unpin(entry.id)),
    keymap: deps.keymap,
    describe: (bind) => describeBinding(bind, (address) => actions.registry.get(address)?.title),
  };
}
