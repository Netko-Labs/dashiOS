/** Work alone (alone/): an agent may ask whether it is on and how long is left, so it can plan. Read-only; nothing here turns it on, lengthens or widens it. */

import type { ToolDef } from "../define.ts";
import { tool } from "./args.ts";

export const aloneTools: readonly ToolDef[] = [
  tool({
    name: "get_work_alone",
    title: "See whether agents work alone",
    description:
      "Whether the person let agents work alone for a set time, how many seconds are left, and what it covers: the kinds of tools and the sites that run without asking until then. " +
      "Everything else asks the person as usual, and payments, sign-ins, the clipboard history, force quit, the Trash and software installs always ask. " +
      "It never asks the person, and you can't turn it on, lengthen it or widen it: only the person can, in System Settings.",
    // Named for the registry; the call itself never waits on a permission (lib/session/session-scopes.ts).
    scope: "see",
    readOnly: true,
    destructive: false,
    args: {},
    build: () => ({ name: "get_work_alone" }),
  }),
];
