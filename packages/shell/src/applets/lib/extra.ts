/** What an applet looks like in the menu bar, and what its hello may claim. */

import { type Applet, type Manifest, permissionName } from "@dashi/applet";
import type { ExtraMenuRow, MenuBarExtra } from "../../extras/index.ts";
import { flattenRows } from "./protocol.ts";

/** What the bar draws for an applet. */
export function appletExtra(key: string, applet: Applet, dev = false): MenuBarExtra {
  const icon =
    applet.glyph !== undefined
      ? { kind: "glyph" as const, markup: applet.glyph }
      : applet.icon !== undefined
        ? { kind: "image" as const, path: applet.icon }
        : null;
  return {
    key,
    source: "applet",
    title: applet.title,
    icon,
    ...(applet.label === undefined ? {} : { label: applet.label }),
    tooltip: applet.tooltip ?? applet.title,
    attention: applet.attention,
    menuOnClick: applet.click === "menu",
    hasMenu: applet.menu.length > 0,
    ...(dev ? { dev: true } : {}),
  };
}

/** An applet's menu rows as the bar's menus take them (submenus flattened under headings). */
export function appletRows(applet: Applet): ExtraMenuRow[] {
  return flattenRows(applet.menu);
}

/** Whether a hello's manifest is the installed one: same id, version, and permissions. */
export function sameManifest(hello: Manifest, installed: Manifest): boolean {
  const names = (manifest: Manifest): string => manifest.permissions.map(permissionName).sort().join("\n");
  return (
    hello.id === installed.id &&
    hello.version === installed.version &&
    names(hello) === names(installed) &&
    JSON.stringify(hello.commands) === JSON.stringify(installed.commands) &&
    JSON.stringify(hello.controls) === JSON.stringify(installed.controls)
  );
}

/** Whether `item` is a row of the applet's menu that can be chosen now. */
export function chosen(applet: Applet, item: string): boolean {
  return appletRows(applet).some((row) => row.kind === "item" && !row.heading && row.id === item && row.enabled);
}
