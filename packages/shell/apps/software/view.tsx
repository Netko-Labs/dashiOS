/**
 * Software's window: a sidebar (Discover, Installed, Updates, and the
 * categories), a toolbar with the search field, and the page for where you
 * are. Searching on Installed filters what is installed; anywhere else it
 * searches Flathub. Every install, removal, and update starts from a click
 * here; a question is asked first where something is taken away or the system
 * is changed.
 */

import { View } from "@mirinjs/metal";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { CATEGORIES, type CategoryId } from "../../src/software/flathub.ts";
import { type InstalledApp } from "../../src/software/flatpak-parse.ts";
import { type Installation } from "../../src/software/ids.ts";
import { useAppMenus } from "../kit/index.ts";
import { AppWindow, EmptyState, glyphs, SearchField, SidebarItem, SidebarSection, ToolbarButton } from "@dashi/ui";
import { AppPage } from "./app-page.tsx";
import { Discover } from "./discover.tsx";
import { useAppName } from "./hooks.ts";
import { CATEGORY_GLYPHS, CATEGORY_TINTS, BACK, DISCOVER, INSTALLED, REFRESH, UPDATES } from "./glyphs.ts";
import { Installed } from "./installed.tsx";
import { Listing } from "./listing.tsx";
import { softwareMenus } from "./menus.ts";
import { appState } from "./model.ts";
import { back, canGoBack, goTo, type Nav, type Page, push, search, START } from "./nav.ts";
import { type Actions, ActionsContext } from "./parts.tsx";
import { useServices } from "./services.ts";
import { type Ask, FailureSheet, Question } from "./sheets.tsx";
import { Updates } from "./updates.tsx";

export const SOFTWARE_SIZE = { width: 1020, height: 700 } as const;

const SEARCH_DELAY_MS = 300;

function pageLabel(page: Page): string {
  switch (page.kind) {
    case "discover":
      return "Discover";
    case "installed":
      return "Installed";
    case "updates":
      return "Updates";
    case "category":
      return CATEGORIES.find((category) => category.id === page.id)?.label ?? "Category";
    case "search":
      return `Results for “${page.query}”`;
    case "app":
      return "";
  }
}

const inSidebar = (nav: Nav, page: Page): boolean => nav.page.kind === page.kind && (page.kind !== "category" || (nav.page.kind === "category" && nav.page.id === page.id));

export function SoftwareWindow() {
  const { store, restart } = useServices();
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [nav, setNav] = useState<Nav>(START);
  const [query, setQuery] = useState("");
  const [ask, setAsk] = useState<Ask | null>(null);
  // Bumped when a sheet closes, so the search field takes the keyboard back.
  const [focus, setFocus] = useState(0);

  useEffect(() => {
    void store.refreshInstalled().then(() => store.checkUpdates());
  }, [store]);

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
  const closeAsk = (): void => {
    setAsk(null);
    setFocus((n) => n + 1);
  };

  const actions: Actions = useMemo(
    () => ({
      openApp: (id) => setNav((now) => push(now, { kind: "app", id })),
      install: (id, name) => store.install(id, name),
      launch: (id) => store.open(id),
      update: (app: InstalledApp, name: string) => store.updateApp(app.installation, { id: app.id, name }),
      updateAll: (installation: Installation) => store.updateApp(installation),
      remove: (app) => setAsk({ kind: "remove", app }),
      cancel: (key) => store.cancel(key),
    }),
    [store],
  );

  const answer = (yes: boolean): void => {
    const current = ask;
    closeAsk();
    if (!yes || !current) return;
    if (current.kind === "remove") store.remove(current.app);
    else if (current.kind === "system") store.updateSystem();
    else restart();
  };

  const appUpdates = state.appUpdates ?? [];
  const systemUpdates = state.system?.updates.length ?? 0;
  const updateCount = appUpdates.length + systemUpdates;
  const askSystem = (): void => setAsk({ kind: "system", count: systemUpdates, restart: (state.system?.restartCauses.length ?? 0) > 0 });

  // The menu bar's menus (src/app-menus/), with the keys they show.
  const openId = nav.page.kind === "app" ? nav.page.id : null;
  const openName = useAppName(openId);
  const { menus, run } = softwareMenus({
    page: nav.page.kind,
    app: openId === null ? null : { id: openId, name: openName ?? openId, state: appState(openId, state.installed ?? [], appUpdates, state.operations) },
    appUpdates: appUpdates.length,
    systemUpdates,
    checking: state.checking,
    updatingApps: state.operations.some((operation) => operation.kind === "update" && operation.id === undefined),
    updatingSystem: state.operations.some((operation) => operation.kind === "system-update"),
    blocked: ask !== null || state.failure !== null,
    actions: {
      search: () => setFocus((n) => n + 1),
      show: (kind) => go({ kind }),
      checkForUpdates: () => {
        go({ kind: "updates" });
        void store.checkUpdates(true);
      },
      updateAllApps: () => {
        for (const installation of new Set(appUpdates.map((update) => update.installation))) actions.updateAll(installation);
      },
      updateSystem: askSystem,
      open: actions.launch,
      install: actions.install,
      update: actions.update,
      remove: actions.remove,
    },
  });
  useAppMenus(menus, run);
  const sidebar = (
    <>
      <SidebarSection>
        <SidebarItem testID="nav:discover" label="Discover" glyph={DISCOVER} selected={inSidebar(nav, { kind: "discover" })} onPress={() => go({ kind: "discover" })} />
        <SidebarItem testID="nav:installed" label="Installed" glyph={INSTALLED} selected={inSidebar(nav, { kind: "installed" })} onPress={() => go({ kind: "installed" })} />
        <SidebarItem
          testID="nav:updates"
          label="Updates"
          glyph={UPDATES}
          badge={updateCount > 0 ? String(updateCount) : undefined}
          selected={inSidebar(nav, { kind: "updates" })}
          onPress={() => go({ kind: "updates" })}
        />
      </SidebarSection>
      <SidebarSection title="Categories">
        {CATEGORIES.map((category) => (
          <SidebarItem
            key={category.id}
            testID={`nav:category:${category.id}`}
            label={category.label}
            tile={{ glyph: CATEGORY_GLYPHS[category.id] ?? DISCOVER, tint: CATEGORY_TINTS[category.id] ?? "#7a7a82" }}
            selected={inSidebar(nav, { kind: "category", id: category.id })}
            onPress={() => go({ kind: "category", id: category.id })}
          />
        ))}
      </SidebarSection>
    </>
  );

  const toolbar = (
    <>
      {canGoBack(nav) && <ToolbarButton testID="back" glyph={BACK} onPress={goBack} />}
      {nav.page.kind === "updates" && (
        <ToolbarButton testID="check-updates" glyph={REFRESH} label={state.checking ? "Checking…" : "Check for Updates"} disabled={state.checking} onPress={() => void store.checkUpdates(true)} />
      )}
      <SearchField
        key={focus}
        testID="search"
        value={query}
        onChangeText={setQuery}
        placeholder={filtering ? "Search Installed" : "Search Apps"}
        width={210}
        autoFocus
        onSubmit={(text) => !filtering && setNav((now) => search(now, text))}
      />
    </>
  );

  const overlay = ask ? <Question ask={ask} onAnswer={answer} /> : state.failure ? <FailureSheet failure={state.failure} onClose={() => { store.dismissFailure(); setFocus((n) => n + 1); }} /> : undefined;

  return (
    <ActionsContext.Provider value={actions}>
      <AppWindow title="Software" subtitle={pageLabel(nav.page) || undefined} sidebar={sidebar} toolbar={toolbar} overlay={overlay}>
        <PageView
          nav={nav}
          query={query}
          onRestart={() => setAsk({ kind: "restart" })}
          onUpdateSystem={askSystem}
        />
      </AppWindow>
    </ActionsContext.Provider>
  );
}

function PageView({ nav, query, onRestart, onUpdateSystem }: { nav: Nav; query: string; onRestart: () => void; onUpdateSystem: () => void }) {
  const { store } = useServices();
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const { page } = nav;
  const browsing = page.kind === "discover" || page.kind === "category" || page.kind === "search" || page.kind === "app";
  if (browsing && !state.hasFlatpak) {
    return (
      <EmptyState testID="no-flatpak" glyph={glyphs.WARNING} title="Flatpak isn't installed" message="Software installs apps with Flatpak. Install the flatpak package, then open Software again." />
    );
  }
  switch (page.kind) {
    case "discover":
      return <Discover />;
    case "category": {
      const label = CATEGORIES.find((category) => category.id === page.id)?.label ?? "Category";
      return <Listing source={{ kind: "category", id: page.id as CategoryId, label }} />;
    }
    case "search":
      return <Listing source={{ kind: "search", query: page.query }} />;
    case "app":
      return <AppPage id={page.id} />;
    case "installed":
      return <Installed query={query} />;
    case "updates":
      return <Updates onRestart={onRestart} onUpdateSystem={onUpdateSystem} />;
  }
}
