/**
 * The Applet Store's menus in the menu bar (the kit's `useAppMenus`), shaped
 * like Software's (apps/software/menus.ts): File (search, and the open
 * applet's Get, Update and Remove…), View (Discover, Installed, Updates) and
 * Store (Check for Updates). Every row is the same click the window offers:
 * Get and Update go through the consent sheet when it is needed, Remove asks
 * first, and agents may not choose any of the three. Without a catalog
 * (no key in this build) only Installed and search are offered.
 */

import { enabledIds, type MenuSpec } from "../kit/index.ts";

export type StorePlace = "discover" | "installed" | "updates";

export interface StoreMenuContext {
  /** The sidebar place showing, or null on an applet's page, a category, or results. */
  place: StorePlace | null;
  /** What the open applet's page can do, or null on any other page. */
  applet: { canGet: boolean; canUpdate: boolean; canRemove: boolean } | null;
  /** Whether there is a catalog to show (src/applet-store/keys.ts). */
  catalogReady: boolean;
  loading: boolean;
  /** A sheet is up: nothing is chosen under it. */
  blocked: boolean;
  actions: {
    search(): void;
    show(place: StorePlace): void;
    checkForUpdates(): void;
    get(): void;
    remove(): void;
  };
}

/** The menus, and what choosing each row does. */
export function storeMenus(context: StoreMenuContext): { menus: MenuSpec[]; run: (id: string) => void } {
  const { actions, applet, blocked, catalogReady } = context;
  const menus: MenuSpec[] = [
    {
      id: "file",
      items: [
        { id: "search", label: "Search", shortcut: "❖F", enabled: !blocked },
        { type: "separator" },
        { id: "applet:get", agents: false, label: "Get", enabled: applet?.canGet === true && !blocked },
        { id: "applet:update", agents: false, label: "Update", enabled: applet?.canUpdate === true && !blocked },
        { id: "applet:remove", agents: false, label: "Remove…", enabled: applet?.canRemove === true && !blocked },
      ],
    },
    {
      id: "view",
      items: [
        { id: "show:discover", label: "Discover", shortcut: "❖1", checked: context.place === "discover", enabled: catalogReady && !blocked },
        { id: "show:installed", label: "Installed", shortcut: "❖2", checked: context.place === "installed", enabled: !blocked },
        { id: "show:updates", label: "Updates", shortcut: "❖3", checked: context.place === "updates", enabled: catalogReady && !blocked },
      ],
    },
    {
      id: "store",
      title: "Store",
      items: [{ id: "check", label: "Check for Updates", shortcut: "❖R", enabled: catalogReady && !context.loading && !blocked }],
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
      case "applet:get":
      case "applet:update":
        return actions.get();
      case "applet:remove":
        return actions.remove();
    }
  };
  return { menus, run };
}
