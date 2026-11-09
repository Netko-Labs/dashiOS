/**
 * Software's window: one store for apps and menu bar applets. A sidebar
 * (Discover, Installed, Updates, Menu bar applets, the categories), one
 * toolbar row (Back, the queue's activity and the "saved results" chip,
 * Check for Updates on Updates, Catalogs… on Menu bar applets, the search
 * field), and the page for where
 * you are. Searching on Installed filters what is installed; anywhere else
 * it searches Flathub and the applets at once. Every install, removal and
 * update starts from a click here, on one queue; a question is asked first
 * where something is taken away, the system is changed, an app reaches far,
 * or an applet asks for something new. In a narrow window the toolbar row
 * gives way in a set order (toolbar-fit.ts).
 */

import type { InstalledApplet, UnreadableApplet } from "@dashi/applet";
import { AppWindow, SearchField, ToolbarButton } from "@dashi/ui";
import { View } from "@mirinjs/metal";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { StoreApplet } from "../../src/applet-store/merge.ts";
import { AppletConsentSheet } from "../../src/applets/consent-sheet.tsx";
import type { InstalledApp } from "../../src/software/flatpak-parse.ts";
import { useAppMenus } from "../kit/index.ts";
import { CatalogsSheet } from "./applets/catalogs-sheet.tsx";
import { useAppletState } from "./applets/rows.tsx";
import { PictureView } from "./gallery.tsx";
import { APPLETS, BACK, REFRESH } from "./glyphs.ts";
import { StaleContext } from "./hooks.ts";
import { softwareMenus } from "./menus.ts";
import { queueLine } from "./model.ts";
import { back, canGoBack, goTo, type Nav, type Page, push, search, startPage } from "./nav.ts";
import { useOpenThing } from "./open-thing.ts";
import { PageView } from "./page-view.tsx";
import { type Actions, ActionsContext } from "./parts.tsx";
import { useServices } from "./services.ts";
import { type Answer, type Ask, FailureSheet, Question } from "./sheets.tsx";
import { SoftwareSidebar } from "./sidebar.tsx";
import { StaleChip, ToolbarChip } from "./states.tsx";
import { CHIP_MAX_WIDTH, isCompact, SEARCH_MIN_WIDTH, SEARCH_WIDTH } from "./toolbar-fit.ts";
import { appTrust, askReasons } from "./trust-words.ts";

/** 640 tall, so it opens whole on a screen as short as 686 points under the menu bar (a 1366 × 768 laptop at 1.1×, the VM). */
export const SOFTWARE_SIZE = { width: 1020, height: 640 } as const;

const SEARCH_DELAY_MS = 300;

type WindowAsk = Ask | { kind: "consent"; entry: StoreApplet; update: boolean };

/** `initialQuery`: open on a search for these words (the launcher's "Find … in Software"); `initialPage`: on a sidebar place (the update notice's Show). */
export function SoftwareWindow({ initialQuery = "", initialPage }: { initialQuery?: string; initialPage?: string } = {}) {
  const { store, applets, catalog, appletImages, restart, openUrl } = useServices();
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const appletState = useAppletState();
  const [nav, setNav] = useState<Nav>(() => startPage(initialPage));
  const [query, setQuery] = useState(initialQuery);
  const [asks, setAsks] = useState<WindowAsk[]>([]);
  const [picture, setPicture] = useState<string | null>(null);
  const [catalogs, setCatalogs] = useState(false);
  const [stale, setStale] = useState(0);
  const reportStale = useCallback((delta: 1 | -1) => setStale((n) => Math.max(0, n + delta)), []);
  // Bumped when a sheet closes, so the search field takes the keyboard back.
  const [focus, setFocus] = useState(0);
  // The page's width (the window less its sidebar): under 600 the toolbar is compact.
  const [pageWidth, setPageWidth] = useState(820);
  const compact = isCompact(pageWidth);

  useEffect(() => {
    void store.refreshInstalled().then(() => store.checkUpdates());
    void applets.refresh();
  }, [store, applets]);

  const filtering = nav.page.kind === "installed";
  useEffect(() => {
    if (filtering) return;
    const timer = setTimeout(() => setNav((now) => search(now, query)), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [query, filtering]);

  const go = (page: Page): void => {
    setQuery("");
    setNav(goTo(page));
  };
  const goBack = (): void => {
    const next = back(nav);
    setNav(next);
    setQuery(next.page.kind === "search" ? next.page.query : "");
  };
  const enqueue = (ask: WindowAsk): void => setAsks((now) => [...now, ask]);

  const actions: Actions = useMemo(
    () => ({
      openApp: (id) => setNav((now) => push(now, { kind: "app", id })),
      openApplet: (id) => setNav((now) => push(now, { kind: "applet", id })),
      install: (id, name) => {
        // The trust card as a sheet first when the app reaches far; one click otherwise (and when Flathub can't say).
        void catalog
          .details(id)
          .then((answer) => answer.value)
          .catch(() => null)
          .then((details) => {
            const reasons = details ? askReasons(details) : [];
            if (details && reasons.length > 0) setAsks((now) => [...now, { kind: "get", id, name, facts: appTrust(details), reasons }]);
            else store.install(id, name);
          });
      },
      launch: (id) => store.open(id),
      update: (app: InstalledApp, name: string) => store.updateApp(app.installation, { id: app.id, name }),
      updateAll: (installation) => store.updateApp(installation),
      remove: (app) => setAsks((now) => [...now, { kind: "remove", app }]),
      cancel: (key) => store.cancel(key),
      getApplet: (entry) => {
        if (applets.needsConsent(entry)) setAsks((now) => [...now, { kind: "consent", entry, update: applets.status(entry).kind !== "get" }]);
        else applets.install(entry);
      },
      removeApplet: (applet: InstalledApplet | UnreadableApplet) =>
        setAsks((now) => [
          ...now,
          "manifest" in applet
            ? { kind: "remove-applet", id: applet.manifest.id, name: applet.manifest.name }
            : { kind: "remove-applet", id: applet.id, name: applet.name ?? applet.id },
        ]),
      openUrl,
      showPicture: setPicture,
    }),
    [store, applets, catalog, openUrl],
  );

  const answer = (reply: Answer): void => {
    const [current, ...rest] = asks;
    setAsks(rest);
    setFocus((n) => n + 1);
    if (!reply.yes || !current) return;
    switch (current.kind) {
      case "remove":
        return store.remove(current.app, reply.deleteData === true);
      case "remove-applet": {
        const there = appletState.installed.some((each) => each.manifest.id === current.id) || appletState.unreadable.some((each) => each.id === current.id);
        if (there) applets.remove(current, reply.deleteData === true);
        return;
      }
      case "get":
        return store.install(current.id, current.name);
      case "consent":
        return applets.install(current.entry);
      case "system":
        return store.updateSystem();
      case "restart":
        return restart();
    }
  };

  const appUpdates = state.appUpdates ?? [];
  const systemUpdates = state.system?.updates.length ?? 0;
  const updateCount = appUpdates.length + systemUpdates + applets.updates().length;
  const askSystem = (): void => enqueue({ kind: "system", count: systemUpdates, restart: (state.system?.restartCauses.length ?? 0) > 0 });

  // The menu bar's menus (src/app-menus/), with the keys they show, acting on the open page's app or applet.
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
    blocked: asks.length > 0 || state.failure !== null || catalogs,
    actions: {
      search: () => setFocus((n) => n + 1),
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

  const activity = queueLine(state.operations, { short: compact });
  const running = state.operations.find((operation) => operation.status === "running");
  const leading = canGoBack(nav) ? <ToolbarButton testID="back" glyph={BACK} tooltip="Back" onPress={goBack} /> : undefined;
  const toolbar = (
    <>
      {stale > 0 && <StaleChip short={compact} />}
      {activity !== null && (
        <ToolbarChip
          testID="activity"
          text={activity}
          maxWidth={CHIP_MAX_WIDTH}
          onPress={() => (running?.id === undefined ? go({ kind: "updates" }) : actions[running.subject === "applet" ? "openApplet" : "openApp"](running.id))}
        />
      )}
      {nav.page.kind === "updates" && (
        <ToolbarButton
          testID="check-updates"
          glyph={REFRESH}
          {...(compact ? { tooltip: "Check for Updates" } : { label: state.checking ? "Checking…" : "Check for Updates" })}
          disabled={state.checking}
          onPress={() => {
            void store.checkUpdates(true);
            void applets.refresh();
          }}
        />
      )}
      {nav.page.kind === "applets" && (
        <ToolbarButton testID="catalogs" glyph={APPLETS} {...(compact ? { tooltip: "Catalogs…" } : { label: "Catalogs…" })} onPress={() => setCatalogs(true)} />
      )}
      <SearchField
        key={focus}
        testID="search"
        value={query}
        onChangeText={setQuery}
        placeholder={compact ? "Search" : filtering ? "Search installed" : "Search apps and applets"}
        width={SEARCH_WIDTH}
        minWidth={SEARCH_MIN_WIDTH}
        autoFocus
        onSubmit={(text) => !filtering && setNav((now) => search(now, text))}
      />
    </>
  );

  const ask = asks[0];
  const closeFailure = (): void => {
    store.dismissFailure();
    setFocus((n) => n + 1);
  };
  const overlay = picture ? (
    <PictureView file={picture} onClose={() => setPicture(null)} />
  ) : catalogs ? (
    <CatalogsSheet
      onClose={() => {
        setCatalogs(false);
        setFocus((n) => n + 1);
      }}
    />
  ) : ask?.kind === "consent" ? (
    <AppletConsentSheet
      manifest={ask.entry.manifest}
      kind={ask.update ? "update" : "get"}
      reviewed={ask.entry.reviewed}
      signed
      granted={applets.granted(ask.entry.manifest.id)}
      icon={appletImages.cached(ask.entry.icon ?? null)}
      onAnswer={(yes) => answer({ yes })}
    />
  ) : ask ? (
    <Question ask={ask} onAnswer={answer} />
  ) : state.failure ? (
    <FailureSheet failure={state.failure} onClose={closeFailure} />
  ) : undefined;

  return (
    <ActionsContext.Provider value={actions}>
      <StaleContext.Provider value={reportStale}>
        <AppWindow
          title="Software"
          leading={leading}
          // Compact: the window's name gives way to the controls (the sidebar says where you are).
          {...(compact ? { center: <View style={{ flex: 1 }} /> } : {})}
          sidebar={<SoftwareSidebar nav={nav} updates={updateCount} go={go} />}
          toolbar={toolbar}
          overlay={overlay}
        >
          <View testID="page-room" onLayout={(bounds) => setPageWidth(bounds.width)} style={{ flex: 1, minHeight: 0, flexDirection: "column" }}>
            <PageView
              nav={nav}
              query={query}
              onRestart={() => enqueue({ kind: "restart" })}
              onUpdateSystem={askSystem}
              onSeeAll={(where) => setNav((now) => push(now, where === "applets" ? { kind: "applets" } : { kind: "collection", id: where }))}
            />
          </View>
        </AppWindow>
      </StaleContext.Provider>
    </ActionsContext.Provider>
  );
}
