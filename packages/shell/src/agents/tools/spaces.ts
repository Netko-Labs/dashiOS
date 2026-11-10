/** Spaces: the desktops side by side, which one shows, and putting a window on another. Agents number them from 1, as people see them ("Desktop 1"). */

import { MAX_SPACES } from "../../spaces/index.ts";
import { tool, wholeArg, windowId } from "./args.ts";
import type { ToolDef } from "./define.ts";

const SPACE_SAYS = `\`space\` must be a Space number from list_spaces, 1 to ${MAX_SPACES}.`;

/** The `space` argument, 1-based as agents count (the compositor's index is 0-based). */
const spaceNumber = wholeArg(1, MAX_SPACES, SPACE_SAYS, "A Space's number from list_spaces: 1 is Desktop 1.");

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
