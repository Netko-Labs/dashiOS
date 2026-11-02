/** Windows and apps: what is open, opening and arranging it, ending it, and locking the screen. */

import { TILES } from "../../layout.ts";
import { fail, type ToolDef, whole, windowArg, windowProp } from "./define.ts";

/** A process id: Linux allows up to 2^22, and 0 and 1 are never an app. */
const PID_MAX = 4_194_304;

const oneWindow = { window: windowProp };

export const windowTools: readonly ToolDef[] = [
  {
    name: "list_windows",
    title: "List windows",
    description:
      "Every window, front to back: id, app id and name, title, process id, whether it is focused, minimized, hidden, zoomed (tiled or filling the screen), or full screen (covering its whole screen, menu bar and Dock included), and its frame in screen points.",
    scope: "see",
    readOnly: true,
    destructive: false,
    properties: {},
    parse: () => ({ name: "list_windows" }),
  },
  {
    name: "list_apps",
    title: "List apps",
    description: "Installed apps (desktop entries): id, name, and whether it is running.",
    scope: "see",
    readOnly: true,
    destructive: false,
    properties: {},
    parse: () => ({ name: "list_apps" }),
  },
  {
    name: "launch_app",
    title: "Open an app",
    description: "Start an installed app by its id or name (see list_apps) and return its first new window, waiting up to 10 seconds for it.",
    scope: "act",
    readOnly: false,
    destructive: false,
    properties: { app: { type: "string", description: 'An app id like "org.gnome.TextEditor", or a name like "Text Editor".' } },
    required: ["app"],
    parse: (args) => {
      const app = typeof args.app === "string" ? args.app.trim() : "";
      return app ? { name: "launch_app", app } : fail("`app` is required: an id or name from list_apps.");
    },
  },
  {
    name: "focus_window",
    title: "Bring a window forward",
    description: "Raise a window and give it the keyboard, restoring it if minimized or hidden.",
    scope: "act",
    readOnly: false,
    destructive: false,
    properties: oneWindow,
    required: ["window"],
    parse: (args) => {
      const window = windowArg(args);
      return typeof window === "number" ? { name: "focus_window", window } : window;
    },
  },
  {
    name: "minimize_window",
    title: "Minimize a window",
    description: "Minimize a window to the Dock.",
    scope: "act",
    readOnly: false,
    destructive: false,
    properties: oneWindow,
    required: ["window"],
    parse: (args) => {
      const window = windowArg(args);
      return typeof window === "number" ? { name: "minimize_window", window } : window;
    },
  },
  {
    name: "close_window",
    title: "Close a window",
    description: "Ask a window to close, as its close button does. The app may ask the person to save first.",
    scope: "act",
    readOnly: false,
    destructive: true,
    properties: oneWindow,
    required: ["window"],
    parse: (args) => {
      const window = windowArg(args);
      return typeof window === "number" ? { name: "close_window", window } : window;
    },
  },
  {
    name: "tile_window",
    title: "Arrange a window",
    description: "Snap a window to half or a quarter of the screen, fill the screen, or restore its previous frame.",
    scope: "act",
    readOnly: false,
    destructive: false,
    idempotent: true,
    properties: { window: windowProp, tile: { type: "string", enum: TILES } },
    required: ["window", "tile"],
    parse: (args) => {
      const window = windowArg(args);
      if (typeof window !== "number") return window;
      const tile = TILES.find((candidate) => candidate === args.tile);
      return tile ? { name: "tile_window", window, tile } : fail(`\`tile\` must be one of: ${TILES.join(", ")}.`);
    },
  },
  {
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
    properties: {
      window: windowProp,
      pid: { type: "integer", minimum: 2, description: "The process id of one of its windows, from list_windows." },
    },
    parse: (args) => {
      if ((args.window === undefined) === (args.pid === undefined)) return fail("Give `window` or `pid`, one of them.");
      if (args.window !== undefined) {
        const window = windowArg(args);
        return typeof window === "number" ? { name: "force_quit_app", target: { window } } : window;
      }
      const pid = whole(args.pid, 2, PID_MAX);
      return pid === null ? fail("`pid` must be a process id from list_windows.") : { name: "force_quit_app", target: { pid } };
    },
  },
  {
    name: "lock_screen",
    title: "Lock the screen",
    description: "Lock the screen, as the person would. Every tool is refused until they unlock it with their password; agents cannot unlock it.",
    scope: "act",
    readOnly: false,
    destructive: false,
    idempotent: true,
    properties: {},
    parse: () => ({ name: "lock_screen" }),
  },
];
