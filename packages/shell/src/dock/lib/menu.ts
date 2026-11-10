/**
 * What an icon's menu in the Dock holds, as data like the menu bar's menus
 * (menus/model.ts): the app's windows with a check on the focused one, then
 * keeping the app in the Dock, then Hide and Quit, or Open when it is not
 * running. A row without an action is disabled.
 */

import { canLaunch } from "../../apps.ts";
import type { MenuEntry } from "../../menus/index.ts";
import type { DockEntry } from "../layout.ts";
import type { DockSettings } from "../settings.ts";
import type { DockMenuAction } from "../types.ts";

const SEPARATOR: MenuEntry<DockMenuAction> = { kind: "separator" };

const item = (label: string, action: DockMenuAction | null, checked?: boolean): MenuEntry<DockMenuAction> => ({
  kind: "item",
  label,
  action,
  ...(checked === undefined ? {} : { checked }),
});

export function buildDockMenu(entry: DockEntry): MenuEntry<DockMenuAction>[] {
  const { app, windows } = entry;
  const running = windows.length > 0;
  // An app that cannot be started again (no launcher entry) cannot be kept or opened.
  const startable = canLaunch(app);
  return [
    ...(running
      ? [
          ...windows.map((window) => {
            const title = window.title.trim() || app.name;
            return item(window.minimized ? `${title} (minimized)` : title, { kind: "focus", window: window.id }, window.activated);
          }),
          SEPARATOR,
        ]
      : []),
    entry.pinned ? item("Remove from Dock", { kind: "unpin", appId: app.id }) : item("Keep in Dock", startable ? { kind: "pin", appId: app.id } : null),
    SEPARATOR,
    ...(running
      ? [
          // Only windows on screen can be hidden, and a window without an app id cannot be found again.
          item("Hide", windows.some((window) => !window.minimized) && app.id ? { kind: "hide", key: entry.key } : null),
          item("Quit", { kind: "quit", key: entry.key, windows: windows.map((window) => window.id) }),
        ]
      : [item("Open", startable ? { kind: "open", appId: app.id } : null)]),
  ];
}

/**
 * The menu of the Dock itself, on a right-click where no icon is: how it
 * looks and whether it hides. The shortcut is shown, bound in keymap.ts.
 */
export function buildDockOptionsMenu(settings: DockSettings): MenuEntry<DockMenuAction>[] {
  return [
    {
      kind: "item",
      label: "Automatically Hide and Show",
      keys: "⌥❖D",
      checked: settings.autohide,
      action: { kind: "dock-prefs", change: { autohide: !settings.autohide } },
    },
    { kind: "item", label: "Hide Dock", action: { kind: "dock-prefs", change: { visible: false } } },
    SEPARATOR,
    item("Dock", { kind: "dock-prefs", change: { style: "dock" } }, settings.style === "dock"),
    item("Taskbar", { kind: "dock-prefs", change: { style: "taskbar" } }, settings.style === "taskbar"),
    SEPARATOR,
    item("Dock Settings…", { kind: "dock-settings" }),
  ];
}
