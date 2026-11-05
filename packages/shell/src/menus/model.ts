/**
 * What each menu holds, as data: pure functions from the desktop's state
 * (the focused window, the windows, what is installed) to rows. A row says
 * what it does as a `MenuAction`, never as a callback, so menus can be
 * tested, listed for agents, and carried out in one place (actions.ts). A
 * row without an action is disabled.
 */

import type { AppMenu, PublishedMenus } from "../app-menus/protocol.ts";
import type { CompositorWindow } from "../compositor.ts";
import type { Tile } from "../layout.ts";
import { sameApp } from "../shortcuts.ts";
import type { EditCommand } from "./keystrokes.ts";

export type MenuId = "dashi" | "app" | "file" | "edit" | "view" | "window" | "help";
/** A menu an app published (app-menus/), by its id: "app:file". */
export type AppMenuKey = `app:${string}`;
/** Any title in the bar. */
export type BarMenuId = MenuId | AppMenuKey;

/** The titles after the Dashi menu and the app's name, left to right. */
export const BAR_MENUS: ReadonlyArray<{ id: BarMenuId; title: string }> = [
  { id: "file", title: "File" },
  { id: "edit", title: "Edit" },
  { id: "view", title: "View" },
  { id: "window", title: "Window" },
  { id: "help", title: "Help" },
];

/** What asks first, then ends the session or the machine. */
export type PowerKind = "restart" | "shutdown" | "logout";

export type MenuAction =
  | { kind: "about-dashi" }
  | { kind: "about-app"; appId: string; name: string; pid: number | null }
  | { kind: "sleep" }
  | { kind: "power"; what: PowerKind }
  | { kind: "lock" }
  | { kind: "force-quit" }
  | { kind: "settings" }
  | { kind: "hide-app"; window: number }
  | { kind: "hide-others"; window: number }
  /** Unhide every hidden app; `window` gets the focus back. */
  | { kind: "show-all"; window: number | null }
  | { kind: "quit-app"; window: number }
  | { kind: "new-window"; appId: string }
  | { kind: "close-window"; window: number }
  | { kind: "minimize"; window: number }
  | { kind: "zoom"; window: number }
  /** Enter full screen, or leave it. */
  | { kind: "fullscreen"; window: number }
  /** Type the app's chord for an Edit row into the window (keystrokes.ts). */
  | { kind: "edit"; window: number; command: EditCommand }
  | { kind: "tile"; window: number; tile: Tile }
  /** Put the window on Desktop `space` (from 0), or on a new one. */
  | { kind: "move-to-space"; window: number; space: number | "new" }
  | { kind: "bring-to-front"; window: number }
  | { kind: "focus"; window: number }
  | { kind: "help" }
  | { kind: "shortcuts" }
  /** An app's own row: the app is told (app-menus/). */
  | { kind: "app-item"; pid: number; id: string; personOnly?: true };

/** A row; `A` is what choosing it does (the Dock's menu has its own actions). */
export type MenuEntry<A = MenuAction> =
  | { kind: "separator" }
  | {
      kind: "item";
      label: string;
      /** Written the Mac way ("⇧❖Z"); only shown, never bound here. */
      keys?: string;
      checked?: boolean;
      action: A | null;
    };

/** What the menus are built from; read when one opens, kept while it is open. */
export interface MenuContext {
  /** The focused app's name as the menu bar shows it ("Desktop" with none). */
  appName: string;
  /** Every window, front to back. */
  windows: readonly CompositorWindow[];
  /** The window that had the keyboard, null with none. */
  focused: CompositorWindow | null;
  /** The app can be started again (a launcher entry exists for it). */
  canLaunch: boolean;
  /** Help can be opened (xdg-open and the README exist). */
  canOpenHelp: boolean;
  /** The menus the focused app published (app-menus/); absent or null with none. */
  app?: PublishedMenus | null;
  /** The Desktops, by what each is called (spaces/names.ts), and the one that shows; absent without them. */
  desktops?: { labels: readonly string[]; current: number };
}

const SEPARATOR: MenuEntry = { kind: "separator" };

const item = (label: string, action: MenuAction | null, keys?: string): MenuEntry => ({ kind: "item", label, keys, action });

const dashiMenu = (): MenuEntry[] => [
  item("About Dashi", { kind: "about-dashi" }),
  SEPARATOR,
  item("System Settings…", { kind: "settings" }, "❖,"),
  SEPARATOR,
  item("Force Quit…", { kind: "force-quit" }, "⌥❖Esc"),
  SEPARATOR,
  item("Sleep", { kind: "sleep" }),
  item("Restart…", { kind: "power", what: "restart" }),
  item("Shut Down…", { kind: "power", what: "shutdown" }),
  SEPARATOR,
  item("Lock Screen", { kind: "lock" }, "⌃❖Q"),
  item("Log Out…", { kind: "power", what: "logout" }),
];

/** Windows of other apps that are on screen: what Hide Others would hide. */
const othersOnScreen = (ctx: MenuContext): boolean =>
  ctx.focused !== null && ctx.windows.some((window) => window.state === "normal" && !sameApp(window, ctx.focused as CompositorWindow));

const appMenu = (ctx: MenuContext): MenuEntry[] => {
  const focused = ctx.focused;
  const name = ctx.appName;
  const hidden = ctx.windows.some((window) => window.state === "hidden");
  // Rows the app adds to its menu ("Settings…") go under About, as on a Mac.
  const own = ctx.app ? appRows(ctx.app, "app") : [];
  return [
    item(`About ${name}`, focused && { kind: "about-app", appId: focused.appId, name, pid: focused.pid }),
    SEPARATOR,
    ...(own.length > 0 ? [...own, SEPARATOR] : []),
    item(`Hide ${name}`, focused && { kind: "hide-app", window: focused.id }, "❖H"),
    item("Hide Others", focused && othersOnScreen(ctx) ? { kind: "hide-others", window: focused.id } : null),
    item("Show All", hidden ? { kind: "show-all", window: focused?.id ?? null } : null),
    SEPARATOR,
    item(`Quit ${name}`, focused && { kind: "quit-app", window: focused.id }, "❖Q"),
  ];
};

const fileMenu = (ctx: MenuContext): MenuEntry[] => [
  item("New Window", ctx.focused && ctx.canLaunch ? { kind: "new-window", appId: ctx.focused.appId } : null, "❖N"),
  SEPARATOR,
  item("Close Window", ctx.focused && { kind: "close-window", window: ctx.focused.id }, "❖W"),
];

// Each row types the app's own chord into the focused window (actions.ts).
const editItem = (ctx: MenuContext, label: string, command: EditCommand, keys: string): MenuEntry =>
  item(label, ctx.focused && { kind: "edit", window: ctx.focused.id, command }, keys);

const editMenu = (ctx: MenuContext): MenuEntry[] => [
  editItem(ctx, "Undo", "undo", "❖Z"),
  editItem(ctx, "Redo", "redo", "⇧❖Z"),
  SEPARATOR,
  editItem(ctx, "Cut", "cut", "❖X"),
  editItem(ctx, "Copy", "copy", "❖C"),
  editItem(ctx, "Paste", "paste", "❖V"),
  editItem(ctx, "Select All", "select-all", "❖A"),
  SEPARATOR,
  editItem(ctx, "Find…", "find", "❖F"),
];

const zoomItem = (ctx: MenuContext): MenuEntry => item("Zoom", ctx.focused && { kind: "zoom", window: ctx.focused.id });

const fullScreenItem = (ctx: MenuContext): MenuEntry =>
  item(ctx.focused?.fullscreen ? "Exit Full Screen" : "Enter Full Screen", ctx.focused && { kind: "fullscreen", window: ctx.focused.id }, "⌃❖F");

const viewMenu = (ctx: MenuContext): MenuEntry[] => [fullScreenItem(ctx), zoomItem(ctx)];

/** The app published menus but no View of its own: Dashi's View is gone from the bar, so Full Screen moves to Window. */
const lacksViewMenu = (ctx: MenuContext): boolean => !!ctx.app && !ctx.app.menus.some((menu) => menu.id === "view" && menu.items.length > 0);

/** The focused app's windows in a steady order (not the stacking order). */
export function appWindows(ctx: MenuContext): CompositorWindow[] {
  const focused = ctx.focused;
  if (!focused) return [];
  return ctx.windows.filter((window) => sameApp(window, focused)).sort((a, b) => a.id - b.id);
}

const TILE_ITEMS: ReadonlyArray<[string, Tile, string]> = [
  ["Tile Left", "left", "⌃❖←"],
  ["Tile Right", "right", "⌃❖→"],
  ["Fill", "fill", "⌃❖↑"],
  ["Restore", "restore", "⌃❖↓"],
];

/** Desktops a window can go to; as many as the compositor allows (comp/src/wm/spaces.rs). */
const MOST_DESKTOPS = 16;

/** "Move to" a Desktop by its name, for every Desktop but the window's own, and a new one. */
const moveToItems = (ctx: MenuContext): MenuEntry[] => {
  const { focused, desktops } = ctx;
  if (!focused || !desktops || desktops.labels.length === 0) return [];
  const own = focused.space ?? desktops.current;
  const others = desktops.labels.flatMap((label, space) =>
    space === own ? [] : [item(`Move to ${label}`, { kind: "move-to-space", window: focused.id, space })],
  );
  const fresh = desktops.labels.length < MOST_DESKTOPS ? [item("Move to New Desktop", { kind: "move-to-space", window: focused.id, space: "new" })] : [];
  return [SEPARATOR, ...others, ...fresh];
};

const windowLabel = (window: CompositorWindow, ctx: MenuContext): string => {
  const title = window.title.trim() || ctx.appName;
  return window.state === "normal" ? title : `${title} (${window.state})`;
};

const windowMenu = (ctx: MenuContext): MenuEntry[] => {
  const focused = ctx.focused;
  const listed = appWindows(ctx);
  return [
    item("Minimize", focused && { kind: "minimize", window: focused.id }, "❖M"),
    zoomItem(ctx),
    ...(lacksViewMenu(ctx) ? [fullScreenItem(ctx)] : []),
    SEPARATOR,
    ...TILE_ITEMS.map(([label, tile, keys]) => item(label, focused && { kind: "tile", window: focused.id, tile }, keys)),
    ...moveToItems(ctx),
    SEPARATOR,
    item("Bring All to Front", focused && { kind: "bring-to-front", window: focused.id }),
    ...(listed.length > 0 ? [SEPARATOR] : []),
    ...listed.map(
      (window): MenuEntry => ({
        kind: "item",
        label: windowLabel(window, ctx),
        checked: window.id === focused?.id,
        action: { kind: "focus", window: window.id },
      }),
    ),
  ];
};

const helpMenu = (ctx: MenuContext): MenuEntry[] => [
  item("Dashi Help", ctx.canOpenHelp ? { kind: "help" } : null),
  item("Keyboard Shortcuts", { kind: "shortcuts" }),
];

/** The rows of the app's menu `menuId`; empty when it has none. */
function appRows(published: PublishedMenus, menuId: string): MenuEntry[] {
  const menu = published.menus.find((each) => each.id === menuId);
  return (menu?.items ?? []).map(
    (row): MenuEntry =>
      row.kind === "separator"
        ? SEPARATOR
        : {
            kind: "item",
            label: row.label,
            ...(row.shortcut === undefined ? {} : { keys: row.shortcut }),
            ...(row.checked === undefined ? {} : { checked: row.checked }),
            action: row.enabled ? { kind: "app-item", pid: published.pid, id: row.id, ...(row.agents === false ? { personOnly: true as const } : {}) } : null,
          },
  );
}

const appKey = (menu: AppMenu): AppMenuKey => `app:${menu.id}`;

/**
 * The titles after the app's name. An app that published menus owns them, as
 * a Mac app does: its menus in its order (a `file`, `edit`, or `view` one in
 * place of Dashi's), and none of Dashi's generic ones; Window and Help stay.
 */
export function barMenus(app: PublishedMenus | null | undefined): ReadonlyArray<{ id: BarMenuId; title: string }> {
  if (!app) return BAR_MENUS;
  const own = app.menus.filter((menu) => menu.id !== "app" && menu.items.length > 0).map((menu) => ({ id: appKey(menu), title: menu.title }));
  return [...own, ...BAR_MENUS.filter((menu) => menu.id === "window" || menu.id === "help")];
}

/** One title of the bar and its rows, as built for a window. */
export interface WindowMenu {
  id: BarMenuId;
  title: string;
  entries: MenuEntry[];
}

export function buildMenu(id: BarMenuId, ctx: MenuContext): MenuEntry[] {
  if (id.startsWith("app:")) {
    const rows = ctx.app ? appRows(ctx.app, id.slice(4)) : [];
    // As on a Mac, the system's Full Screen row ends an app's own View menu, so it is there in every app.
    return id === "app:view" && rows.length > 0 ? [...rows, SEPARATOR, fullScreenItem(ctx)] : rows;
  }
  switch (id as MenuId) {
    case "dashi":
      return dashiMenu();
    case "app":
      return appMenu(ctx);
    case "file":
      return fileMenu(ctx);
    case "edit":
      return editMenu(ctx);
    case "view":
      return viewMenu(ctx);
    case "window":
      return windowMenu(ctx);
    case "help":
      return helpMenu(ctx);
  }
}

/** Every menu of the bar for `ctx`'s focused window, the Dashi menu aside: the app menu (titled with its name), then `barMenus`. */
export function windowMenus(ctx: MenuContext): WindowMenu[] {
  return [{ id: "app" as const, title: ctx.appName }, ...barMenus(ctx.app)].map((menu) => ({ ...menu, entries: buildMenu(menu.id, ctx) }));
}

/** Whether a row can be chosen. */
export const isEnabled = (entry: MenuEntry<unknown>): boolean => entry.kind === "item" && entry.action !== null;

/**
 * The row an arrow key moves to from `from` (null: nothing highlighted),
 * skipping separators and disabled rows and wrapping around; null when
 * nothing can be chosen.
 */
export function stepHighlight(entries: readonly MenuEntry<unknown>[], from: number | null, direction: "up" | "down"): number | null {
  const count = entries.length;
  const delta = direction === "down" ? 1 : -1;
  let index = from ?? (direction === "down" ? -1 : count);
  for (let tried = 0; tried < count; tried++) {
    index = (index + delta + count) % count;
    const entry = entries[index];
    if (entry && isEnabled(entry)) return index;
  }
  return null;
}
