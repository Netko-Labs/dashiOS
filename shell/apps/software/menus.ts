/**
 * Software's menus in the menu bar (the kit's `useAppMenus`): File (search,
 * and the open app page's Open, Install, Update, and Remove), View (the three
 * places in the sidebar), and Store (checking for updates, and updating). The
 * shortcuts are real, as on a Mac: the shell matches a ❖ chord against the
 * focused app's enabled rows (app-menus/shortcut.ts). Every row that changes
 * the machine is the same click the window offers: Install and Update All run
 * as their buttons do, Remove and the system update ask first, and a row that
 * cannot run now is disabled, so it has no key either.
 */

import type { InstalledApp } from "../../src/software/flatpak-parse.ts";
import { enabledIds, type MenuSpec } from "../kit/index.ts";
import type { AppState } from "./model.ts";
import type { Page } from "./nav.ts";

/** The app whose page is open. */
export interface OpenApp {
  id: string;
  name: string;
  state: AppState;
}

export interface SoftwareMenuContext {
  page: Page["kind"];
  /** The open app page's app, or null on any other page. */
  app: OpenApp | null;
  /** Apps with an update waiting, and system packages with one. */
  appUpdates: number;
  systemUpdates: number;
  /** A look for updates is running. */
  checking: boolean;
  /** "Update all" for the apps, or the system update, is running. */
  updatingApps: boolean;
  updatingSystem: boolean;
  /** A sheet is up: nothing is chosen under it. */
  blocked: boolean;
  actions: {
    search(): void;
    show(page: "discover" | "installed" | "updates"): void;
    checkForUpdates(): void;
    updateAllApps(): void;
    updateSystem(): void;
    open(id: string): void;
    install(id: string, name: string): void;
    update(app: InstalledApp, name: string): void;
    remove(app: InstalledApp): void;
  };
}

/** The menus, and what choosing each row does. */
export function softwareMenus(context: SoftwareMenuContext): { menus: MenuSpec[]; run: (id: string) => void } {
  const { actions, app, blocked } = context;
  const kind = app?.state.kind;
  const installed = kind === "open" || kind === "update";

  const menus: MenuSpec[] = [
    {
      id: "file",
      items: [
        { id: "search", label: "Search", shortcut: "❖F", enabled: !blocked },
        { type: "separator" },
        { id: "app:open", label: "Open", shortcut: "❖O", enabled: installed && !blocked },
        { id: "app:install", agents: false, label: "Install", enabled: kind === "get" && !blocked },
        { id: "app:update", agents: false, label: "Update", enabled: kind === "update" && !blocked },
        { id: "app:remove", agents: false, label: "Remove…", enabled: installed && !blocked },
      ],
    },
    {
      id: "view",
      items: [
        { id: "show:discover", label: "Discover", shortcut: "❖1", checked: context.page === "discover", enabled: !blocked },
        { id: "show:installed", label: "Installed", shortcut: "❖2", checked: context.page === "installed", enabled: !blocked },
        { id: "show:updates", label: "Updates", shortcut: "❖3", checked: context.page === "updates", enabled: !blocked },
      ],
    },
    {
      id: "store",
      title: "Store",
      items: [
        { id: "check", label: "Check for Updates", shortcut: "❖R", enabled: !context.checking && !blocked },
        { type: "separator" },
        { id: "update-apps", agents: false, label: "Update All Apps", enabled: context.appUpdates > 0 && !context.updatingApps && !blocked },
        { id: "update-system", agents: false, label: "Update System Software…", enabled: context.systemUpdates > 0 && !context.updatingSystem && !blocked },
      ],
    },
  ];

  const run = (id: string): void => {
    if (!enabledIds(menus).has(id)) return;
    switch (id) {
      case "search":
        return actions.search();
      case "show:discover":
        return actions.show("discover");
      case "show:installed":
        return actions.show("installed");
      case "show:updates":
        return actions.show("updates");
      case "check":
        return actions.checkForUpdates();
      case "update-apps":
        return actions.updateAllApps();
      case "update-system":
        return actions.updateSystem();
    }
    if (!app) return;
    if (id === "app:open" && (app.state.kind === "open" || app.state.kind === "update")) actions.open(app.id);
    else if (id === "app:install" && app.state.kind === "get") actions.install(app.id, app.name);
    else if (id === "app:update" && app.state.kind === "update") actions.update(app.state.installed, app.name);
    else if (id === "app:remove" && (app.state.kind === "open" || app.state.kind === "update")) actions.remove(app.state.installed);
  };
  return { menus, run };
}
