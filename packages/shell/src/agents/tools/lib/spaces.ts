/** Spaces: the desktops side by side, which one shows, and putting a window on another. Agents number them from 1, as people see them ("Desktop 1"). */

import { MAX_SPACES } from "../../../spaces/index.ts";
import type { ToolDef } from "../define.ts";
import { custom, tool, wholeArg, windowId } from "./args.ts";

const SPACE_SAYS = `\`space\` must be a Space number from list_spaces, 1 to ${MAX_SPACES}.`;

/** The `space` argument, 1-based as agents count (the compositor's index is 0-based). */
const spaceNumber = wholeArg(1, MAX_SPACES, SPACE_SAYS, "A Space's number from list_spaces: 1 is Desktop 1.");

/** `work_in_space`'s `space`: a Space's number (kept from 0, as the compositor counts), "new", or "shown". */
const workSpace = custom<number | "new" | "shown">(
  {
    description: 'Where to work: a Space\'s number from list_spaces, "new" for a Space added at the end for you, or "shown" to work where the person is again.',
    anyOf: [{ type: "integer", minimum: 1, maximum: MAX_SPACES }, { enum: ["new", "shown"] }],
  },
  (value) => {
    if (value === "new" || value === "shown") return value;
    return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_SPACES ? value - 1 : null;
  },
  `\`space\` must be a Space number from list_spaces (1 to ${MAX_SPACES}), "new", or "shown".`,
);

export const spaceTools: readonly ToolDef[] = [
  tool({
    name: "list_spaces",
    title: "List Spaces",
    description:
      "The Spaces (desktops side by side, as on a Mac): each one's number and name, which one shows, and the ids of the windows on it. A window in full screen gets a Space of its own (`fullScreenOf`), named after its app, which goes away when it leaves full screen. Only the windows of the Space that shows are on screen; list_windows gives each window's `space` too.",
    scope: "see",
    readOnly: true,
    destructive: false,
    args: {},
    build: () => ({ name: "list_spaces" }),
  }),
  tool({
    name: "switch_space",
    title: "Switch to a Space",
    description: "Show another Space, as ⌃→ or a three-finger swipe does: its windows slide in and the front one gets the keyboard.",
    scope: "act",
    readOnly: false,
    destructive: false,
    idempotent: true,
    args: { space: spaceNumber },
    build: ({ space }) => ({ name: "switch_space", space: space - 1 }),
  }),
  tool({
    name: "work_in_space",
    title: "Work on another Desktop",
    description:
      'Work on another Space without moving the person\'s screen. Use it only when the person asks for another desktop ("on another desktop", "on Desktop 3", "out of my way") or to be left undisturbed; otherwise work where they are, so they can watch. ' +
      "After it, the windows you open (launch_app, open_url, open_file, open_in_preview) land on that Space and the view stays where it is; click, type, press keys, read pages and take window screenshots there as anywhere, " +
      "and focus_window raises a window there without switching. An app already open on the Space that shows is left there: the result says so, and move_window_to_space brings its window over if the person wants that. " +
      'A whole-screen screenshot still shows what the person sees, not your Space. "new" adds a Space for you, removed when you leave it empty; "shown" goes back to working where the person is. ' +
      "It answers the Space's number and name, and holds for this connection only.",
    scope: "act",
    readOnly: false,
    destructive: false,
    idempotent: true,
    args: { space: workSpace },
    build: ({ space }) => ({ name: "work_in_space", space }),
  }),
  tool({
    name: "move_window_to_space",
    title: "Move a window to a Space",
    description:
      "Put a window on another Space. Moved off the Space that shows, it leaves the screen until that Space is shown (switch_space, or focus_window, which goes to its Space).",
    scope: "act",
    readOnly: false,
    destructive: false,
    idempotent: true,
    args: { window: windowId, space: spaceNumber },
    build: ({ window, space }) => ({ name: "move_window_to_space", window, space: space - 1 }),
  }),
];
