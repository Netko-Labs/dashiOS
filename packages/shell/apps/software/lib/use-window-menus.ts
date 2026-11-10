/**
 * Software's menu bar menus for this window (menus.ts): what the menus show
 * and what their rows do, from the open page's place, its app or applet
 * (open-thing.ts), and the update checks. Registered with the kit's
 * `useAppMenus`, so the shell's shortcuts reach them.
 */

import { useAppMenus } from "../kit/index.ts";
import { softwareMenus } from "./menus.ts";
import { canGoBack, type Nav, type Page } from "./nav.ts";
import { useOpenThing } from "./open-thing.ts";
import type { Actions } from "./parts.tsx";
import type { Services } from "./services.ts";
import type { SoftwareState } from "./store.ts";

export interface WindowMenuInput {
  nav: Nav;
  goBack(): void;
  go(page: Page): void;
  refocus(): void;
  store: Services["store"];
  applets: Services["applets"];
  state: SoftwareState;
  /** A sheet is up, or the failure sheet: nothing is chosen under it. */
  blocked: boolean;
  actions: Actions;
  askSystem(): void;
}

export function useWindowMenus({ nav, goBack, go, refocus, store, applets, state, blocked, actions, askSystem }: WindowMenuInput): void {
  const appUpdates = state.appUpdates ?? [];
  const systemUpdates = state.system?.updates.length ?? 0;
  // The menu bar's menus, with the keys they show, acting on the open page's app or applet.
  const thing = useOpenThing(nav.page, actions);
  const place =
    nav.page.kind === "discover" || nav.page.kind === "installed" || nav.page.kind === "updates" || nav.page.kind === "applets" ? nav.page.kind : null;
  const { menus, run } = softwareMenus({
    place,
    canGoBack: canGoBack(nav),
    thing: thing?.can ?? null,
    // The place is always there: it is where a catalog is added (Catalogs…), even before Dashi's opens.
    appletsReady: true,
    appUpdates: appUpdates.length,
    systemUpdates,
    checking: state.checking,
    updatingApps: state.operations.some((operation) => operation.kind === "update" && operation.id === undefined),
    updatingSystem: state.operations.some((operation) => operation.kind === "system-update"),
    blocked,
    actions: {
      search: refocus,
      back: goBack,
      show: (where) => go({ kind: where }),
      checkForUpdates: () => {
        go({ kind: "updates" });
        void store.checkUpdates(true);
        void applets.refresh();
      },
      updateAllApps: () => {
        for (const installation of new Set(appUpdates.map((update) => update.installation))) actions.updateAll(installation);
      },
      updateSystem: askSystem,
      open: () => thing?.open(),
      get: () => thing?.get(),
      update: () => thing?.update(),
      remove: () => thing?.remove(),
    },
  });
  useAppMenus(menus, run);
}
