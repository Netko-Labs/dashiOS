/**
 * Dashi's own commands, the rows of the Dashi menu (menus/model.ts) and a
 * few more, at `dashi://dashi/<command>`. Each runs the menu's own action
 * (menus/actions.ts), so Restart asks first here as it does from the menu.
 */

import type { Keymap } from "../../keymap.ts";
import type { MenuAction } from "../../menus/model.ts";
import { formatAddress } from "../address.ts";
import { keyFor } from "../keys.ts";
import { type ActionDef, type ActionKind, ok, ready } from "../types.ts";

interface Command {
  id: string;
  title: string;
  words: readonly string[];
  kind: ActionKind;
  action: MenuAction;
  /** As the Dashi menu shows it, when the keymap doesn't bind the address. */
  shortcut?: string;
  /** Ends the session or the machine: it asks first, on its own sheet. */
  ends?: true;
  done: string;
}

const COMMANDS: readonly Command[] = [
  { id: "about", title: "About Dashi", words: ["version", "about"], kind: "open", action: { kind: "about-dashi" }, done: "About Dashi is open." },
  {
    id: "settings",
    title: "System Settings",
    words: ["settings", "preferences", "control panel"],
    kind: "open",
    action: { kind: "settings" },
    shortcut: "❖,",
    done: "System Settings is open.",
  },
  {
    id: "force-quit",
    title: "Force Quit…",
    words: ["force quit", "kill", "frozen", "not responding"],
    kind: "open",
    action: { kind: "force-quit" },
    shortcut: "⌥❖Esc",
    done: "Force Quit is open.",
  },
  { id: "sleep", title: "Sleep", words: ["suspend", "sleep"], kind: "run", action: { kind: "sleep" }, done: "Going to sleep." },
  {
    id: "restart",
    title: "Restart…",
    words: ["reboot", "restart"],
    kind: "run",
    action: { kind: "power", what: "restart" },
    ends: true,
    done: "Asking about restarting.",
  },
  {
    id: "shut-down",
    title: "Shut Down…",
    words: ["power off", "shutdown", "turn off"],
    kind: "run",
    action: { kind: "power", what: "shutdown" },
    ends: true,
    done: "Asking about shutting down.",
  },
  { id: "lock-screen", title: "Lock Screen", words: ["lock"], kind: "run", action: { kind: "lock" }, shortcut: "⌃❖Q", done: "The screen is locked." },
  {
    id: "log-out",
    title: "Log Out…",
    words: ["sign out", "logout", "log off"],
    kind: "run",
    action: { kind: "power", what: "logout" },
    ends: true,
    done: "Asking about logging out.",
  },
  {
    id: "shortcuts",
    title: "Keyboard shortcuts",
    words: ["keys", "hotkeys", "cheat sheet"],
    kind: "open",
    action: { kind: "shortcuts" },
    done: "Shortcuts are showing.",
  },
];

/** Dashi's own commands; `run` carries out the Dashi menu's action. */
export function commandActions(run: (action: MenuAction) => Promise<void>, keymap: Keymap): ActionDef[] {
  return COMMANDS.map((command): ActionDef => {
    const address = formatAddress(["dashi", command.id]);
    const shortcut = keyFor(address, keymap) ?? command.shortcut;
    return {
      address,
      title: command.title,
      description: "",
      keywords: { en: [...command.words, "dashi"] },
      kind: command.kind,
      properties: {},
      scope: null,
      readOnly: false,
      // Ending the session or the machine loses what isn't saved; it asks on its own sheet first.
      destructive: command.ends === true,
      ...(command.ends ? { asksEveryTime: true as const } : {}),
      who: "person",
      source: "dashi",
      ...(shortcut ? { shortcut } : {}),
      check: () =>
        ready(async () => {
          await run(command.action);
          return ok(command.done);
        }),
    };
  });
}
