/**
 * The Applet Store's window, shaped like Software: a sidebar (Discover,
 * Installed, Updates, and the categories), a toolbar with Back and the
 * search field, and the page for where you are. Getting an applet that asks
 * for anything shows the consent sheet first; removing one asks too.
 */

import type { IndexApplet, InstalledApplet } from "@dashi/applet";
import { AlertSheet, AppWindow, ConfirmSheet, SearchField, SidebarItem, SidebarSection, TINTS, ToolbarButton, WARNING } from "@dashi/ui";
import { View } from "@mirinjs/metal";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppletConsentSheet } from "../../src/applets/consent-sheet.tsx";
import { useAppMenus } from "../kit/index.ts";
import { BACK, CATEGORY_GLYPHS, CATEGORY_TINTS, DISCOVER, INSTALLED, REFRESH, UPDATES } from "../software/glyphs.ts";
import { type StorePlace, storeMenus } from "./menus.ts";
import { back, CATEGORY_LABELS, canGoBack, goTo, type Nav, type Page, push, START, search } from "./nav.ts";
import { AppletPage } from "./page.tsx";
import { InstalledPage, ListPage, UpdatesPage } from "./pages.tsx";
import { type Actions, ActionsContext, useStoreState } from "./rows.tsx";
import { useServices } from "./services.ts";

export const STORE_SIZE = { width: 960, height: 640 } as const;

/** Each category's nearest in Software, whose glyph and tint its tile wears, so one category looks the same in both stores. */
const NEAREST: Readonly<Record<keyof typeof CATEGORY_LABELS, string>> = {
  hardware: "System",
  productivity: "Office",
  network: "Network",
  status: "Utility",
  media: "AudioVideo",
  developer: "Development",
  utilities: "Utility",
};

const tileOf = (id: keyof typeof CATEGORY_LABELS): { glyph: string; tint: string } => {
  const software = NEAREST[id];
  return { glyph: CATEGORY_GLYPHS[software] ?? DISCOVER, tint: CATEGORY_TINTS[software] ?? TINTS.goma };
};

const PLACES: Readonly<Record<StorePlace, Page>> = { discover: { kind: "all" }, installed: { kind: "installed" }, updates: { kind: "updates" } };

/** The sidebar place `page` is, if it is one. */
function placeOf(page: Page): StorePlace | null {
  if (page.kind === "all") return "discover";
  return page.kind === "installed" || page.kind === "updates" ? page.kind : null;
}

type Ask = { kind: "consent"; entry: IndexApplet; update: boolean } | { kind: "remove"; installed: InstalledApplet } | { kind: "failure"; message: string };

const SEARCH_DELAY_MS = 250;

const inSidebar = (nav: Nav, page: Page): boolean => JSON.stringify(nav.page) === JSON.stringify(page);

export function StoreWindow() {
  const { store } = useServices();
  const state = useStoreState();
  // Without a catalog key nothing from the catalog can be shown, so the window is Installed alone.
  const ready = store.catalogReady;
  const [nav, setNav] = useState<Nav>(() => (ready ? START : goTo({ kind: "installed" })));
  const [query, setQuery] = useState("");
  const [asks, setAsks] = useState<Ask[]>([]);
  const [focus, setFocus] = useState(0);

  useEffect(() => {
    void store.refresh();
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
  const enqueue = useCallback((ask: Ask): void => setAsks((now) => [...now, ask]), []);

  const actions: Actions = useMemo(
    () => ({
      openApplet: (id) => setNav((now) => push(now, { kind: "applet", id })),
      get: (entry) => {
        if (store.needsConsent(entry)) enqueue({ kind: "consent", entry, update: store.status(entry).kind !== "get" });
        else void store.install(entry);
      },
      remove: (installed) => enqueue({ kind: "remove", installed }),
    }),
    [store, enqueue],
  );

  // A failure from the store is a sheet too, after any question.
  useEffect(() => {
    if (state.failure) enqueue({ kind: "failure", message: state.failure });
  }, [state.failure, enqueue]);

  const answer = (yes: boolean): void => {
    const [current, ...rest] = asks;
    setAsks(rest);
    setFocus((n) => n + 1);
    if (!current) return;
    if (current.kind === "failure") return store.dismissFailure();
    if (!yes) return;
    if (current.kind === "consent") void store.install(current.entry);
    else store.remove(current.installed.manifest.id);
  };

  // The open applet's page, for the File menu's Get, Update and Remove….
  const openId = nav.page.kind === "applet" ? nav.page.id : null;
  const openEntry = openId === null ? undefined : state.index?.applets.find((entry) => entry.manifest.id === openId);
  const openStatus = openEntry ? store.status(openEntry) : null;
  const { menus, run } = storeMenus({
    place: placeOf(nav.page),
    applet: openStatus
      ? {
          canGet: openStatus.kind === "get" && openStatus.version !== null,
          canUpdate: openStatus.kind === "update" || (openStatus.kind === "pulled" && openStatus.good !== null),
          canRemove: openStatus.kind !== "get",
        }
      : null,
    catalogReady: ready,
    loading: state.loading,
    blocked: asks.length > 0,
    actions: {
      search: () => setFocus((n) => n + 1),
      show: (place) => go(PLACES[place]),
      checkForUpdates: () => void store.refresh(),
      get: () => openEntry && actions.get(openEntry),
      remove: () => openStatus && openStatus.kind !== "get" && actions.remove(openStatus.installed),
    },
  });
  useAppMenus(menus, run);

  const updateCount = store.updates().length;
  const sidebar = (
    <>
      <SidebarSection>
        {ready && (
          <SidebarItem testID="nav:all" label="Discover" glyph={DISCOVER} selected={inSidebar(nav, { kind: "all" })} onPress={() => go({ kind: "all" })} />
        )}
        <SidebarItem
          testID="nav:installed"
          label="Installed"
          glyph={INSTALLED}
          badge={state.installed.length > 0 ? String(state.installed.length) : undefined}
          selected={inSidebar(nav, { kind: "installed" })}
          onPress={() => go({ kind: "installed" })}
        />
        {ready && (
          <SidebarItem
            testID="nav:updates"
            label="Updates"
            glyph={UPDATES}
            badge={updateCount > 0 ? String(updateCount) : undefined}
            selected={inSidebar(nav, { kind: "updates" })}
            onPress={() => go({ kind: "updates" })}
          />
        )}
      </SidebarSection>
      {ready && (
        <SidebarSection title="Categories">
          {(Object.keys(CATEGORY_LABELS) as Array<keyof typeof CATEGORY_LABELS>).map((id) => (
            <SidebarItem
              key={id}
              testID={`nav:category:${id}`}
              label={CATEGORY_LABELS[id]}
              tile={tileOf(id)}
              selected={inSidebar(nav, { kind: "category", id })}
              onPress={() => go({ kind: "category", id })}
            />
          ))}
        </SidebarSection>
      )}
    </>
  );

  const toolbar = (
    <>
      {canGoBack(nav) && <ToolbarButton testID="back" glyph={BACK} onPress={() => setNav(back(nav))} />}
      {ready && <ToolbarButton testID="refresh" glyph={REFRESH} disabled={state.loading} onPress={() => void store.refresh()} />}
      <SearchField
        key={focus}
        testID="search"
        value={query}
        onChangeText={setQuery}
        placeholder={filtering ? "Search Installed" : "Search Applets"}
        width={210}
        autoFocus
        onSubmit={(text) => !filtering && setNav((now) => search(now, text))}
      />
    </>
  );

  const ask = asks[0];
  const overlay =
    ask?.kind === "consent" ? (
      // The shell's consent sheet fills the surface it is given: here, the whole window, over its content.
      <View occlude style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, backgroundColor: "#00000026" }}>
        <AppletConsentSheet manifest={ask.entry.manifest} reviewed={ask.entry.reviewed} update={ask.update} onAnswer={answer} />
      </View>
    ) : ask?.kind === "remove" ? (
      <ConfirmSheet
        testID="remove-sheet"
        title={`Remove “${ask.installed.manifest.name}”?`}
        message="It leaves the menu bar and this computer. What it saved stays, so getting it again picks up where it left off."
        confirmLabel="Remove"
        danger
        onConfirm={() => answer(true)}
        onCancel={() => answer(false)}
      />
    ) : ask?.kind === "failure" ? (
      // It only informs: one button, which Esc and Enter press too (UI-5).
      <AlertSheet
        testID="failure-sheet"
        question="That didn’t work"
        message={ask.message}
        glyph={WARNING}
        tone="warning"
        buttons={[{ label: "OK", testID: "failure-sheet:ok", onPress: () => answer(true), kind: "primary" }]}
      />
    ) : undefined;

  return (
    <ActionsContext.Provider value={actions}>
      <AppWindow title="Applet Store" sidebar={sidebar} toolbar={toolbar} overlay={overlay}>
        <PageView page={nav.page} query={query} catalogReady={ready} />
      </AppWindow>
    </ActionsContext.Provider>
  );
}

function PageView({ page, query, catalogReady }: { page: Page; query: string; catalogReady: boolean }) {
  if (!catalogReady) return <InstalledPage query={query} catalogReady={false} />;
  switch (page.kind) {
    case "all":
    case "category":
    case "search":
      return <ListPage page={page} />;
    case "applet":
      return <AppletPage id={page.id} />;
    case "installed":
      return <InstalledPage query={query} />;
    case "updates":
      return <UpdatesPage />;
  }
}
