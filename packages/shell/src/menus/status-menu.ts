/**
 * The menus under the status area's items: a menu bar extra's (a tray
 * icon's or an applet's, extras/) and the battery's. They open from the
 * right of the bar, below the item, and run through the one popover
 * (controller.ts).
 */

import type { ExtraMenuRow } from "../extras/index.ts";
import type { AllowSleep } from "../inhibit/menu.ts";
import { type Battery, formatMinutes } from "../system/battery.ts";
import type { MenuEntry } from "./model.ts";

/** A chosen row: an extra's (its source carries it out), or the battery menu's way to Settings. */
export type StatusMenuAction =
  | { kind: "extra"; key: string; id: string }
  | { kind: "battery-settings" }
  /** An app using significant energy was chosen: Activity Monitor shows what it is doing. */
  | { kind: "activity-monitor" }
  /** "Allow Sleep" under what keeps the computer awake (inhibit/menu.ts). */
  | AllowSleep;

/** What the battery's menu shows beyond the battery: the battery monitor's draw and heavy apps (battery/). */
export interface BatteryUse {
  watts: number | null;
  /** The apps using significant energy, heaviest first. */
  apps: readonly { name: string }[];
}

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

/**
 * The battery's menu, as a Mac's: the charge, the power source, the time,
 * the draw, the apps using significant energy (each opens Activity
 * Monitor), then Settings.
 */
export function batteryEntries(battery: Battery, use: BatteryUse = { watts: null, apps: [] }): MenuEntry<StatusMenuAction>[] {
  const info = (label: string): MenuEntry<StatusMenuAction> => ({ kind: "item", label, action: null });
  const draw =
    use.watts === null || battery.state === "full" || battery.state === "plugged"
      ? []
      : [info(`${battery.state === "charging" ? "Charging at" : "Power Draw:"} ${use.watts.toFixed(1)} W`)];
  const apps: MenuEntry<StatusMenuAction>[] =
    use.apps.length === 0
      ? []
      : [
          { kind: "separator" },
          info("Using Significant Energy"),
          ...use.apps.slice(0, 5).map((app): MenuEntry<StatusMenuAction> => ({ kind: "item", label: app.name, action: { kind: "activity-monitor" } })),
        ];
  return [
    info(`Battery  ${battery.percent}%`),
    info(`Power Source: ${battery.state === "discharging" ? "Battery" : "Power Adapter"}`),
    info(batteryStatus(battery)),
    ...draw,
    ...apps,
    { kind: "separator" },
    { kind: "item", label: "Battery Settings…", action: { kind: "battery-settings" } },
  ];
}
