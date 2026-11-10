/** The desktop itself: Force Quit and the lock, Spaces, notifications, menus, and the software the person can ask for. */

import * as desktop from "../../desktop/index.ts";
import type { Handlers } from "./run-types.ts";

export const desktopHandlers = {
  force_quit_app: (call, ctx) => desktop.forceQuitApp(call.target, ctx),
  lock_screen: (_call, ctx) => desktop.lockScreen(ctx),
  list_spaces: (_call, ctx) => desktop.listSpaces(ctx),
  switch_space: (call, ctx) => desktop.switchSpace(call.space, ctx),
  move_window_to_space: (call, ctx) => desktop.moveWindowToSpace(call.window, call.space, ctx),
  list_notifications: (call, ctx) => desktop.listNotifications(call.limit, ctx),
  dismiss_notification: (call, ctx) => desktop.dismissNotification(call.id, ctx),
  clear_notifications: (_call, ctx) => desktop.clearNotifications(ctx),
  list_menus: (call, ctx) => desktop.listMenus(call.window, ctx),
  choose_menu_item: (call, ctx) => desktop.chooseMenuItem(call.window, call.menu, call.item, ctx),
  search_software: (call, ctx) => desktop.searchSoftware(call, ctx),
  get_software: (call, ctx) => desktop.getSoftware(call, ctx),
  list_installed_software: (_call, ctx) => desktop.listInstalledSoftware(ctx),
  list_software_updates: (_call, ctx) => desktop.listSoftwareUpdates(ctx),
  request_software_install: (call, ctx) => desktop.requestInstall(call, ctx),
  request_software_update: (call, ctx) => desktop.requestUpdate(call, ctx),
} satisfies Handlers<
  | "force_quit_app"
  | "lock_screen"
  | "list_spaces"
  | "switch_space"
  | "move_window_to_space"
  | "list_notifications"
  | "dismiss_notification"
  | "clear_notifications"
  | "list_menus"
  | "choose_menu_item"
  | "search_software"
  | "get_software"
  | "list_installed_software"
  | "list_software_updates"
  | "request_software_install"
  | "request_software_update"
>;
