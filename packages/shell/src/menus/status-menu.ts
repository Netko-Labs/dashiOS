/**
 * The menus under the status area's items: a menu bar extra's (a tray
 * icon's or an applet's, extras/). They open from the right of the bar,
 * below the item, and run through the one popover (controller.ts). The
 * battery's is a panel now (battery/lib/panel.tsx), and its rows' actions are
 * these.
 */

import type { ExtraMenuRow } from "../extras/index.ts";
import type { AllowSleep } from "../inhibit/index.ts";
import type { LaptopAction } from "../laptop/index.ts";
import type { MenuEntry } from "./types.ts";

/** A chosen row: an extra's (its source carries it out), or one of the battery panel's. */
export type StatusMenuAction =
  | { kind: "extra"; key: string; id: string }
  | { kind: "battery-settings" }
  /** "Using significant energy" or one of its apps was chosen: Activity Monitor's Energy tab, with that app selected. */
  | { kind: "activity-monitor"; app?: { key: string; name: string } }
  /** A laptop row: the power mode, the charge, the graphics card's holders (laptop/menu.ts). */
  | { kind: "laptop"; action: LaptopAction }
  /** "Allow Sleep" under what keeps the computer awake (inhibit/menu.ts). */
  | AllowSleep;

/** An extra's rows as menu entries: a submenu's heading shown, never chosen, and its rows indented under it. */
export function extraEntries(key: string, rows: readonly ExtraMenuRow[]): MenuEntry<StatusMenuAction>[] {
  return rows.map((row) => {
    if (row.kind === "separator") return { kind: "separator" };
    const indent = "    ".repeat(row.depth ?? 0);
    return {
      kind: "item",
      label: `${indent}${row.label}`,
      ...(row.checked === undefined ? {} : { checked: row.checked }),
      action: row.enabled && !row.heading ? { kind: "extra", key, id: row.id } : null,
    };
  });
}
