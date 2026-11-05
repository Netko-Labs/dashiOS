/**
 * The Applet Store's window, shaped like Software: a sidebar (Discover,
 * Installed, Updates, and the categories), a toolbar with Back and the
 * search field, and the page for where you are. Getting an applet that asks
 * for anything shows the consent sheet first; removing one asks too.
 */

import type { IndexApplet, InstalledApplet } from "@dashi/applet";
import { AppWindow, ConfirmSheet, SearchField, SidebarItem, SidebarSection, ToolbarButton } from "@dashi/ui";
import { View } from "@mirinjs/metal";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppletConsentSheet } from "../../src/applets/consent-sheet.tsx";
import { BACK, CATEGORY_GLYPHS, DISCOVER, INSTALLED, REFRESH, UPDATES } from "../software/glyphs.ts";
import { back, CATEGORY_LABELS, canGoBack, goTo, type Nav, type Page, push, START, search } from "./nav.ts";
import { AppletPage } from "./page.tsx";
import { InstalledPage, ListPage, UpdatesPage } from "./pages.tsx";
import { type Actions, ActionsContext, useStoreState } from "./rows.tsx";
import { useServices } from "./services.ts";

export const STORE_SIZE = { width: 960, height: 640 } as const;

/** The sidebar's tile for each category: Software's glyph for the nearest of its categories, a tint of its own. */
const CATEGORY_TILES: Readonly<Record<keyof typeof CATEGORY_LABELS, { glyph: string; tint: string }>> = {
  hardware: { glyph: CATEGORY_GLYPHS.System ?? DISCOVER, tint: "#7a7a82" },
  productivity: { glyph: CATEGORY_GLYPHS.Office ?? DISCOVER, tint: "#3b8fd0" },
  network: { glyph: CATEGORY_GLYPHS.Network ?? DISCOVER, tint: "#2f9d8f" },
  status: { glyph: CATEGORY_GLYPHS.Utility ?? DISCOVER, tint: "#c7892b" },
  media: { glyph: CATEGORY_GLYPHS.AudioVideo ?? DISCOVER, tint: "#d0527f" },
  developer: { glyph: CATEGORY_GLYPHS.Development ?? DISCOVER, tint: "#6E56CF" },
  utilities: { glyph: CATEGORY_GLYPHS.Utility ?? DISCOVER, tint: "#4f8f4f" },
};

type Ask = { kind: "consent"; entry: IndexApplet; update: boolean } | { kind: "remove"; installed: InstalledApplet } | { kind: "failure"; message: string };

const SEARCH_DELAY_MS = 250;

const inSidebar = (nav: Nav, page: Page): boolean => JSON.stringify(nav.page) === JSON.stringify(page);

export function StoreWindow() {
  const { store } = useServices();
  const state = useStoreState();
  const [nav, setNav] = useState<Nav>(START);
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

  const updateCount = store.updates().length;
  const sidebar = (
    <>
      <SidebarSection>
        <SidebarItem testID="nav:all" label="Discover" glyph={DISCOVER} selected={inSidebar(nav, { kind: "all" })} onPress={() => go({ kind: "all" })} />
        <SidebarItem
          testID="nav:installed"
          label="Installed"
          glyph={INSTALLED}
          badge={state.installed.length > 0 ? String(state.installed.length) : undefined}
          selected={inSidebar(nav, { kind: "installed" })}
          onPress={() => go({ kind: "installed" })}
        />
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
        {(Object.keys(CATEGORY_LABELS) as Array<keyof typeof CATEGORY_LABELS>).map((id) => (
          <SidebarItem
            key={id}
            testID={`nav:category:${id}`}
            label={CATEGORY_LABELS[id]}
            tile={CATEGORY_TILES[id]}
            selected={inSidebar(nav, { kind: "category", id })}
            onPress={() => go({ kind: "category", id })}
          />
        ))}
      </SidebarSection>
    </>
  );

  const toolbar = (
    <>
      {canGoBack(nav) && <ToolbarButton testID="back" glyph={BACK} onPress={() => setNav(back(nav))} />}
      <ToolbarButton testID="refresh" glyph={REFRESH} disabled={state.loading} onPress={() => void store.refresh()} />
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
      <ConfirmSheet
        testID="failure-sheet"
        title="That didn't work"
        message={ask.message}
        confirmLabel="OK"
        onConfirm={() => answer(true)}
        onCancel={() => answer(false)}
      />
    ) : undefined;

  return (
    <ActionsContext.Provider value={actions}>
      <AppWindow title="Applet Store" sidebar={sidebar} toolbar={toolbar} overlay={overlay}>
        <PageView page={nav.page} query={query} />
      </AppWindow>
    </ActionsContext.Provider>
  );
}

function PageView({ page, query }: { page: Page; query: string }) {
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
