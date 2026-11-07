/**
 * What Activity Monitor is asked to show, from its command line or from a
 * second start while it runs (the kit's `onOpen`): `--tab energy` opens a
 * tab, `--app <key> [--app-name <name>]` selects an app (the battery menu,
 * src/menus/activity-monitor.ts). Anything else is ignored (the Metal host's
 * path is read by the kit).
 */

import type { Tab } from "./monitor.ts";

export interface OpenRequest {
  tab?: Tab;
  app?: { key: string; name?: string };
}

const TABS: readonly Tab[] = ["cpu", "memory", "energy", "disk", "network"];

export function parseOpenArgs(args: readonly string[]): OpenRequest {
  const value = (flag: string): string | undefined => {
    const at = args.indexOf(flag);
    const next = at >= 0 ? args[at + 1] : undefined;
    return next !== undefined && !next.startsWith("--") && next !== "" ? next : undefined;
  };
  const tab = TABS.find((each) => each === value("--tab"));
  const key = value("--app");
  const name = value("--app-name");
  return { ...(tab ? { tab } : {}), ...(key ? { app: { key, ...(name ? { name } : {}) } } : {}) };
}
