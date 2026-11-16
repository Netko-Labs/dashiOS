/**
 * The browser's tabs (docs/actions.md, "Websites"): list them across
 * Helium's windows, bring one forward, close, reload, and go back or
 * forward. Nothing here asks: closing a tab loses nothing for good, and the
 * person sees it happen (decisions.md D204, the critical-only consent rule).
 */

import type { ToolDef } from "../define.ts";
import { custom, tool } from "./args.ts";
import { parseTabId, tabArg } from "./browser.ts";

const tabTool = (name: "reload_tab" | "go_back" | "go_forward", title: string, description: string): ToolDef =>
  tool({
    name,
    title,
    description,
    scope: "web",
    readOnly: false,
    destructive: false,
    args: { tab: tabArg() },
    build: ({ tab }) => ({ name, tab: tab ?? null }),
  });

export const tabTools: readonly ToolDef[] = [
  tool({
    name: "list_tabs",
    title: "List the browser's tabs",
    description:
      "Every tab in every Helium window: its id, title and address, which is in front of its window and which window is in front, and the tabs you opened.",
    scope: "web",
    readOnly: true,
    destructive: false,
    idempotent: true,
    args: {},
    build: () => ({ name: "list_tabs" }),
  }),
  tool({
    name: "switch_tab",
    title: "Switch to a browser tab",
    description: "Bring a tab to the front of its window; it becomes the tab the website tools use.",
    scope: "web",
    readOnly: false,
    destructive: false,
    args: {
      tab: custom({ type: "string", description: 'A tab id from list_tabs, like "t12".' }, parseTabId, (given) =>
        given === undefined || given === null ? "`tab` is required: an id from list_tabs." : `\`${String(given)}\` is not a tab id; ids look like "t12".`,
      ),
    },
    build: ({ tab }) => ({ name: "switch_tab", tab }),
  }),
  tool({
    name: "close_tab",
    title: "Close a browser tab",
    description:
      "Close a tab (default: the one you used last). Prefer closing tabs you opened (list_tabs marks them `yours`); close the person's only when they ask.",
    scope: "web",
    readOnly: false,
    destructive: false,
    args: { tab: tabArg() },
    build: ({ tab }) => ({ name: "close_tab", tab: tab ?? null }),
  }),
  tabTool("reload_tab", "Reload a browser tab", "Load a tab's page again and return once it has loaded, with its address and title."),
  tabTool(
    "go_back",
    "Go back in a browser tab",
    "Go back one page in a tab's history, as the Back button, and return once it has loaded, with where it is now.",
  ),
  tabTool("go_forward", "Go forward in a browser tab", "Go forward one page in a tab's history, and return once it has loaded, with where it is now."),
];
