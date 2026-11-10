/**
 * Dashi's own commands, the rows of the Dashi menu (menus/model.ts) and a
 * few more, at `dashi://dashi/<command>`. Each runs the menu's own action
 * (menus/lib/actions.ts), so Restart asks first here as it does from the menu;
 * the screenshots run what ⇧❖3, ⇧❖4 and ⇧❖5 bind (keymap.ts binds them
 * here), on the window focused when they were asked.
 */

import type { Keymap } from "../../../keymap.ts";
import type { MenuAction } from "../../../menus/index.ts";
import { formatAddress } from "../../address.ts";
import { keyFor } from "../../keys.ts";
import { type ActionDef, type ActionKind, type CaptureKind, ok, ready } from "../../types.ts";

/** Carries a screenshot out (main.tsx: screenshots.ts, screenshot-area.tsx, recorder/); `window` is the one focused when it was asked. */
export type RunCapture = (what: CaptureKind, window: number | null) => Promise<void>;

type Command = {
  id: string;
  title: string;
  words: readonly string[];
  kind: ActionKind;
  /** As the Dashi menu shows it, when the keymap doesn't bind the address. */
  shortcut?: string;
  /** Ends the session or the machine: it asks first, on its own sheet. */
  ends?: true;
  /** It saves a picture of the screen at once: a link from outside only opens it for the person (run.ts), never takes the picture itself. */
  sees?: true;
  done: string;
} & ({ action: MenuAction } | { capture: CaptureKind });

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
  {
    id: "capture",
    title: "Screenshot…",
    words: ["screenshot", "screen shot", "capture", "screen capture", "record screen", "screen recording", "print screen", "snip", "grab"],
    kind: "open",
    capture: "toolbar",
    done: "The screenshot toolbar is open.",
  },
  {
    id: "screenshot",
    title: "Screenshot of the Screen",
    words: ["screenshot", "capture screen", "whole screen"],
    kind: "run",
    capture: "screen",
    sees: true,
    done: "The screenshot is in Pictures, Screenshots.",
  },
  {
    id: "screenshot-area",
    title: "Screenshot of an Area…",
    words: ["screenshot", "capture area", "selection", "region", "part of the screen"],
    kind: "run",
    capture: "area",
    done: "Drag out the area to capture.",
  },
];

/** Dashi's own commands; `run` carries out the Dashi menu's action, `capture` a screenshot (without it, there are none). */
export function commandActions(run: (action: MenuAction) => Promise<void>, keymap: Keymap, capture?: RunCapture): ActionDef[] {
  const commands = capture ? COMMANDS : COMMANDS.filter((command) => !("capture" in command));
  return commands.map((command): ActionDef => {
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
      // A picture of the screen is not a link's to take: a program would have the screen without asking for it.
      ...(command.sees ? { linkOpens: true as const } : {}),
      who: "person",
      source: "dashi",
      ...(shortcut ? { shortcut } : {}),
      check: () =>
        ready(async (ctx) => {
          if ("capture" in command) await capture?.(command.capture, ctx.window);
          else await run(command.action);
          return ok(command.done);
        }),
    };
  });
}
