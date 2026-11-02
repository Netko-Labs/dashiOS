/**
 * The menus under the status area's items: a menu bar extra's (a tray
 * icon's or an applet's, extras/) and the battery's. They open from the
 * right of the bar, below the item, and run through the one popover
 * (controller.ts).
 */

import type { ExtraMenuRow } from "../extras/index.ts";
import { type Battery, formatMinutes } from "../system/battery.ts";
import type { MenuEntry } from "./model.ts";

/** A chosen row: an extra's (its source carries it out), or the battery menu's way to Settings. */
export type StatusMenuAction = { kind: "extra"; key: string; id: string } | { kind: "battery-settings" };

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

/** What the battery is doing, in words: the menu's second line. */
export function batteryStatus(battery: Battery): string {
  switch (battery.state) {
    case "charging":
      return battery.minutesLeft === undefined ? "Charging" : `${formatMinutes(battery.minutesLeft)} until full`;
    case "discharging":
      return battery.minutesLeft === undefined ? "Calculating time left…" : `${formatMinutes(battery.minutesLeft)} remaining`;
    case "full":
      return "Fully charged";
    case "plugged":
      return "Not charging";
  }
}

/** The battery's menu, as a Mac's: the charge, the power source, the time, then Settings. */
export function batteryEntries(battery: Battery): MenuEntry<StatusMenuAction>[] {
  const info = (label: string): MenuEntry<StatusMenuAction> => ({ kind: "item", label, action: null });
  return [
    info(`Battery  ${battery.percent}%`),
    info(`Power Source: ${battery.state === "discharging" ? "Battery" : "Power Adapter"}`),
    info(batteryStatus(battery)),
    { kind: "separator" },
    { kind: "item", label: "Battery Settings…", action: { kind: "battery-settings" } },
  ];
}
