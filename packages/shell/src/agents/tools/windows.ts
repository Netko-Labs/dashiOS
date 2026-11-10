/** Windows and apps: what is open, opening and arranging it, ending it, and locking the screen. */

import { optional } from "@dashi/shape";
import { ARRANGE } from "../../layout.ts";
import { custom, tool, windowId } from "./args.ts";
import { fail, type ToolDef, whole } from "./define.ts";

/** A process id: Linux allows up to 2^22, and 0 and 1 are never an app. */
const PID_MAX = 4_194_304;

export const windowTools: readonly ToolDef[] = [
  tool({
    name: "list_windows",
    title: "List windows",
    description:
      "Every window, front to back: id, app id and name, title, process id, whether it is focused, minimized, or hidden, how it is arranged (`arrangement`: a half, a quarter, or fill, from tile_window, the keys, or a drag; null at its own size), whether it is full screen (covering its whole screen, menu bar and Dock included), and its frame in screen points.",
    scope: "see",
    readOnly: true,
    destructive: false,
    args: {},
    build: () => ({ name: "list_windows" }),
  }),
  tool({
    name: "list_apps",
    title: "List apps",
    description: "Installed apps (desktop entries): id, name, and whether it is running.",
    scope: "see",
    readOnly: true,
    destructive: false,
    args: {},
    build: () => ({ name: "list_apps" }),
  }),
  tool({
    name: "launch_app",
    title: "Open an app",
    description:
      "Open an installed app by its id or name (see list_apps) and return its window: one already open comes forward (restored if minimized); otherwise the app starts and its first new window is returned, waiting up to 10 seconds for it.",
    scope: "act",
    readOnly: false,
    destructive: false,
    args: {
      app: custom(
        { type: "string", description: 'An app id like "org.gnome.TextEditor", or a name like "Text Editor".' },
        (value) => (typeof value === "string" ? value.trim() || null : null),
        "`app` is required: an id or name from list_apps.",
      ),
    },
    build: ({ app }) => ({ name: "launch_app", app }),
  }),
  tool({
    name: "focus_window",
    title: "Bring a window forward",
    description: "Raise a window and give it the keyboard, restoring it if minimized or hidden.",
    scope: "act",
    readOnly: false,
    destructive: false,
    args: { window: windowId },
    build: ({ window }) => ({ name: "focus_window", window }),
  }),
  tool({
    name: "minimize_window",
    title: "Minimize a window",
    description: "Minimize a window to the Dock.",
    scope: "act",
    readOnly: false,
    destructive: false,
    args: { window: windowId },
    build: ({ window }) => ({ name: "minimize_window", window }),
  }),
  tool({
    name: "close_window",
    title: "Close a window",
    description: "Ask a window to close, as its close button does. The app may ask the person to save first.",
    scope: "act",
    readOnly: false,
    destructive: true,
    args: { window: windowId },
    build: ({ window }) => ({ name: "close_window", window }),
  }),
  tool({
    name: "tile_window",
    title: "Arrange a window",
    description:
      "Arrange a window on its screen: a half (left, right, top, bottom) or a quarter, with a small gap; fill (all of the area the menu bar and Dock leave, no gap, and the app is told it is maximized); center (its own size, centered); or restore (back to the size and place it had before it was arranged; does nothing if it is not arranged).",
    scope: "act",
    readOnly: false,
    destructive: false,
    idempotent: true,
    args: {
      window: windowId,
      tile: custom(
        { type: "string", enum: ARRANGE },
        (value) => ARRANGE.find((candidate) => candidate === value) ?? null,
        `\`tile\` must be one of: ${ARRANGE.join(", ")}.`,
      ),
    },
    build: ({ window, tile }) => ({ name: "tile_window", window, tile }),
  }),
  tool({
    name: "force_quit_app",
    title: "Force quit an app",
    description:
      "End an app that is stuck, as Force Quit Applications does: every window of its process closes at once and anything unsaved is lost. " +
      "Name it by `window` (an id from list_windows) or by `pid` (its process id from list_windows), not both. " +
      "The person is asked on screen every time, whatever they have allowed before; try close_window first. " +
      "The shell and the session cannot be force quit, nor processes with no window.",
    scope: "act",
    readOnly: false,
    destructive: true,
    args: {
      window: optional(windowId),
      // The listing says "from 2"; the top of a process id is the check's.
      pid: optional(
        custom(
          { type: "integer", minimum: 2, description: "The process id of one of its windows, from list_windows." },
          (value) => whole(value, 2, PID_MAX),
          "`pid` must be a process id from list_windows.",
        ),
      ),
    },
    build: ({ window, pid }) => {
      if (window !== undefined && pid === undefined) return { name: "force_quit_app", target: { window } };
      if (pid !== undefined && window === undefined) return { name: "force_quit_app", target: { pid } };
      return fail("Give `window` or `pid`, one of them.");
    },
  }),
  tool({
    name: "lock_screen",
    title: "Lock the screen",
    description: "Lock the screen, as the person would. Every tool is refused until they unlock it with their password; agents cannot unlock it.",
    scope: "act",
    readOnly: false,
    destructive: false,
    idempotent: true,
    args: {},
    build: () => ({ name: "lock_screen" }),
  }),
];
