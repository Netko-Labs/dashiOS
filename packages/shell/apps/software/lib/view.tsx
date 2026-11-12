/**
 * Software's window, its layout only: one store for apps and menu bar
 * applets, composed into the app window (AppWindow) from the sidebar
 * (sidebar.tsx), one toolbar row (toolbar.tsx), the sheets over the page
 * (window-overlay.tsx), and the page for where you are (page-view.tsx). The
 * state each part reads lives in its hook: where you are (use-navigation.ts),
 * the sheets and their queue (use-window-sheets.ts), what a click does
 * (use-window-actions.ts), and the menu bar (use-window-menus.ts). Searching on
 * Installed filters what is installed; anywhere else it searches Flathub and
 * the applets at once. Every install, removal and update starts from a click
 * here, on one queue; a question is asked first where something is taken
 * away, the system is changed, an app reaches far, or an applet asks for
 * something new. In a narrow window the toolbar row gives way in a set order
 * (toolbar-fit.ts).
 */

import { AppWindow, ToolbarButton } from "@dashi/ui";
import { View } from "@mirinjs/metal";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useAppletState } from "./applets/rows.tsx";
import { BACK } from "./glyphs.ts";
import { StaleContext } from "./hooks.ts";
import { canGoBack, push } from "./nav.ts";
import { PageView } from "./page-view.tsx";
import { ActionsContext } from "./parts.tsx";
import { useServices } from "./services.ts";
import { SoftwareSidebar } from "./sidebar.tsx";
import { SoftwareToolbar } from "./toolbar.tsx";
import { isCompact } from "./toolbar-fit.ts";
import { useNavigation } from "./use-navigation.ts";
import { useWindowActions } from "./use-window-actions.ts";
import { useWindowMenus } from "./use-window-menus.ts";
import { useWindowSheets } from "./use-window-sheets.ts";
import { windowOverlay } from "./window-overlay.tsx";

/** 640 tall, so it opens whole on a screen as short as 686 points under the menu bar (a 1366 × 768 laptop at 1.1×, the VM). */
export const SOFTWARE_SIZE = { width: 1020, height: 640 } as const;

/** `initialQuery`: open on a search for these words (the launcher's "Find … in Software"); `initialPage`: on a sidebar place (the update notice's Show). */
type Services = ReturnType<typeof useServices>;

/** Looks for updates when the window opens, and gives the toolbar's "check now". */
function useUpdateChecks(store: Services["store"], applets: Services["applets"]): () => void {
  useEffect(() => {
    void store.refreshInstalled().then(() => store.checkUpdates());
    void applets.refresh();
  }, [store, applets]);
  return () => {
    void store.checkUpdates(true);
    void applets.refresh();
  };
}

export function SoftwareWindow({ initialQuery = "", initialPage }: { initialQuery?: string; initialPage?: string } = {}) {
  const { store, applets, catalog, appletImages, restart, openUrl } = useServices();
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const appletState = useAppletState();
  const { nav, setNav, query, setQuery, filtering, go, goBack } = useNavigation(initialQuery, initialPage);
  const sheets = useWindowSheets({ store, applets, restart, appletState });
  const actions = useWindowActions({ store, applets, catalog, openUrl, setNav, enqueue: sheets.enqueue, setPicture: sheets.setPicture });
  const [stale, setStale] = useState(0);
  const reportStale = useCallback((delta: 1 | -1) => setStale((n) => Math.max(0, n + delta)), []);
  // The page's width (the window less its sidebar): under 600 the toolbar is compact.
  const [pageWidth, setPageWidth] = useState(820);
  const compact = isCompact(pageWidth);

  const checkForUpdates = useUpdateChecks(store, applets);

  const systemUpdates = state.system?.updates.length ?? 0;
  const updateCount = (state.appUpdates?.length ?? 0) + systemUpdates + applets.updates().length;
  const askSystem = (): void => sheets.enqueue({ kind: "system", count: systemUpdates, restart: (state.system?.restartCauses.length ?? 0) > 0 });
  useWindowMenus({
    nav,
    goBack,
    go,
    refocus: sheets.refocus,
    store,
    applets,
    state,
    blocked: sheets.asks.length > 0 || state.failure !== null || sheets.catalogs,
    actions,
    askSystem,
  });

  const leading = canGoBack(nav) ? <ToolbarButton testID="back" glyph={BACK} tooltip="Back" onPress={goBack} /> : undefined;

  return (
    <ActionsContext.Provider value={actions}>
      <StaleContext.Provider value={reportStale}>
        <AppWindow
          title="Software"
          leading={leading}
          // Compact: the window's name gives way to the controls (the sidebar says where you are).
          {...(compact ? { center: <View style={{ flex: 1 }} /> } : {})}
          sidebar={<SoftwareSidebar nav={nav} updates={updateCount} go={go} />}
          toolbar={
            <SoftwareToolbar
              nav={nav}
              setNav={setNav}
              query={query}
              setQuery={setQuery}
              filtering={filtering}
              compact={compact}
              stale={stale}
              operations={state.operations}
              checking={state.checking}
              focus={sheets.focus}
              go={go}
              actions={actions}
              openCatalogs={sheets.openCatalogs}
              onCheckUpdates={checkForUpdates}
            />
          }
          overlay={windowOverlay({ sheets, failure: state.failure, applets, appletImages })}
        >
          <View testID="page-room" onLayout={(bounds) => setPageWidth(bounds.width)} style={{ flex: 1, minHeight: 0, flexDirection: "column" }}>
            <PageView
              nav={nav}
              query={query}
              onRestart={() => sheets.enqueue({ kind: "restart" })}
              onUpdateSystem={askSystem}
              onSeeAll={(where) => setNav((now) => push(now, where === "applets" ? { kind: "applets" } : { kind: "collection", id: where }))}
            />
          </View>
        </AppWindow>
      </StaleContext.Provider>
    </ActionsContext.Provider>
  );
}
