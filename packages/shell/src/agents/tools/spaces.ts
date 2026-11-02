/** Spaces: the desktops side by side, which one shows, and putting a window on another. Agents number them from 1, as people see them ("Desktop 1"). */

import { MAX_SPACES } from "../../spaces/model.ts";
import { fail, type ToolDef, whole, windowArg, windowProp } from "./define.ts";

const spaceProp = { type: "integer", minimum: 1, maximum: MAX_SPACES, description: "A Space's number from list_spaces: 1 is Desktop 1." };

/** The `space` argument, 1-based, to the compositor's 0-based index. */
function spaceArg(value: unknown): number | null {
  const space = whole(value, 1, MAX_SPACES);
  return space === null ? null : space - 1;
}

export const spaceTools: readonly ToolDef[] = [
  {
    name: "list_spaces",
    title: "List Spaces",
    description:
      "The Spaces (desktops side by side, as on a Mac): each one's number and name, which one shows, and the ids of the windows on it. Only the windows of the Space that shows are on screen; list_windows gives each window's `space` too.",
    scope: "see",
    readOnly: true,
    destructive: false,
    properties: {},
    parse: () => ({ name: "list_spaces" }),
  },
  {
    name: "switch_space",
    title: "Switch to a Space",
    description: "Show another Space, as ⌃→ or a three-finger swipe does: its windows slide in and the front one gets the keyboard.",
    scope: "act",
    readOnly: false,
    destructive: false,
    idempotent: true,
    properties: { space: spaceProp },
    required: ["space"],
    parse: (args) => {
      const space = spaceArg(args.space);
      return space === null ? fail(`\`space\` must be a Space number from list_spaces, 1 to ${MAX_SPACES}.`) : { name: "switch_space", space };
    },
  },
  {
    name: "move_window_to_space",
    title: "Move a window to a Space",
    description:
      "Put a window on another Space. Moved off the Space that shows, it leaves the screen until that Space is shown (switch_space, or focus_window, which goes to its Space).",
    scope: "act",
    readOnly: false,
    destructive: false,
    idempotent: true,
    properties: { window: windowProp, space: spaceProp },
    required: ["window", "space"],
    parse: (args) => {
      const window = windowArg(args);
      if (typeof window !== "number") return window;
      const space = spaceArg(args.space);
      return space === null ? fail(`\`space\` must be a Space number from list_spaces, 1 to ${MAX_SPACES}.`) : { name: "move_window_to_space", window, space };
    },
  },
];
