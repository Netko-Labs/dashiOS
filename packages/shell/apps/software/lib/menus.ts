/**
 * Software's menus in the menu bar (the kit's `useAppMenus`): File (search,
 * and the open page's Open, Get, Update and Remove…, for an app or an
 * applet), Go (Back and the sidebar's places), and Store (checking for
 * updates, and updating). The shortcuts are real, as on a Mac: the shell
 * matches a ❖ chord against the focused app's enabled rows
 * (app-menus/shortcut.ts). Every row that changes the machine is the same
 * click the window offers: Get and Update run as their buttons do (with
 * their sheet when one comes first), Remove and the system update ask
 * first, agents may choose none of them, and a row that can't run now is
 * disabled, so it has no key either.
 */

import { enabledIds, type MenuSpec } from "../../kit/index.ts";

export type Place = "discover" | "installed" | "updates" | "applets";

/** What the open page's thing can do: an app's or an applet's. */
export interface OpenThing {
  canOpen: boolean;
  canGet: boolean;
  canUpdate: boolean;
  canRemove: boolean;
  /** Get and Update ask first (broad access, new permissions): their rows say "…". */
  asks: boolean;
}

export interface SoftwareMenuContext {
  /** The sidebar place showing, or null on any other page. */
  place: Place | null;
  canGoBack: boolean;
  /** The open page's app or applet, or null on any other page. */
  thing: OpenThing | null;
  /** Whether the applets have a catalog (their place is in the sidebar). */
  appletsReady: boolean;
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
    back(): void;
    show(place: Place): void;
    checkForUpdates(): void;
    updateAllApps(): void;
    updateSystem(): void;
    open(): void;
    get(): void;
    update(): void;
    remove(): void;
  };
}

/** The menus, and what choosing each row does. */
export function softwareMenus(context: SoftwareMenuContext): { menus: MenuSpec[]; run: (id: string) => void } {
  const { actions, thing, blocked } = context;
  const dots = thing?.asks ? "…" : "";
  const menus: MenuSpec[] = [
    {
      id: "file",
      items: [
        { id: "search", label: "Search", shortcut: "❖F", enabled: !blocked },
        { type: "separator" },
        { id: "item:open", label: "Open", shortcut: "❖O", enabled: thing?.canOpen === true && !blocked },
        { id: "item:get", agents: false, label: `Get${dots}`, enabled: thing?.canGet === true && !blocked },
        { id: "item:update", agents: false, label: `Update${dots}`, enabled: thing?.canUpdate === true && !blocked },
        { id: "item:remove", agents: false, label: "Remove…", enabled: thing?.canRemove === true && !blocked },
      ],
    },
    {
      id: "go",
      title: "Go",
      items: [
        { id: "back", label: "Back", shortcut: "❖[", enabled: context.canGoBack && !blocked },
        { type: "separator" },
        { id: "show:discover", label: "Discover", shortcut: "❖1", checked: context.place === "discover", enabled: !blocked },
        { id: "show:installed", label: "Installed", shortcut: "❖2", checked: context.place === "installed", enabled: !blocked },
        { id: "show:updates", label: "Updates", shortcut: "❖3", checked: context.place === "updates", enabled: !blocked },
        ...(context.appletsReady
          ? [{ id: "show:applets", label: "Menu Bar Applets", shortcut: "❖4", checked: context.place === "applets", enabled: !blocked }]
          : []),
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
      case "back":
        return actions.back();
      case "show:discover":
      case "show:installed":
      case "show:updates":
      case "show:applets":
        return actions.show(id.slice("show:".length) as Place);
      case "check":
        return actions.checkForUpdates();
      case "update-apps":
        return actions.updateAllApps();
      case "update-system":
        return actions.updateSystem();
      case "item:open":
        return actions.open();
      case "item:get":
        return actions.get();
      case "item:update":
        return actions.update();
      case "item:remove":
        return actions.remove();
    }
  };
  return { menus, run };
}
