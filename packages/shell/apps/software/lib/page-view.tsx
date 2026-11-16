/** The page for where the window is: a sidebar place, a list, an app's or an applet's page. */

import { EmptyState, glyphs } from "@dashi/ui";
import { useSyncExternalStore } from "react";
import { CATEGORIES, type Collection } from "../../../src/shared/software/index.ts";
import { AppPage } from "./app-page.tsx";
import { AppletPage } from "./applets/page.tsx";
import { AppletsPage } from "./applets/pages.tsx";
import { Discover, SECTIONS } from "./discover.tsx";
import { EntryPage } from "./entry-page.tsx";
import { Installed } from "./installed.tsx";
import { Listing } from "./listing.tsx";
import type { Nav, Page } from "./nav.ts";
import { SearchPage } from "./search-page.tsx";
import { useServices } from "./services.ts";
import { AppsPage, ExtensionsPage, WidgetsPage } from "./shelves.tsx";
import { Updates } from "./updates.tsx";

export interface PageViewProps {
  nav: Nav;
  query: string;
  onRestart: () => void;
  onUpdateSystem: () => void;
  onLogOut: () => void;
  /** Goes to a page in place (the Apps page's chips). */
  replace: (page: Page) => void;
  onSeeAll: (place: Collection | "applets") => void;
}

export function PageView({ nav, query, onRestart, onUpdateSystem, onLogOut, replace, onSeeAll }: PageViewProps) {
  const { store } = useServices();
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const { page } = nav;
  const flathub = page.kind === "discover" || page.kind === "category" || page.kind === "collection" || page.kind === "app" || page.kind === "apps";
  if (flathub && !state.hasFlatpak) {
    return (
      <EmptyState
        testID="no-flatpak"
        glyph={glyphs.WARNING}
        title="Flatpak isn’t installed"
        message="The Store installs Flathub’s apps with Flatpak. Install the flatpak package, then open the Store again. Search still finds Fedora’s packages."
      />
    );
  }
  switch (page.kind) {
    case "discover":
      return <Discover onSeeAll={onSeeAll} />;
    case "category": {
      const label = CATEGORIES.find((category) => category.id === page.id)?.label ?? "Category";
      return <Listing source={{ kind: "category", id: page.id, label }} />;
    }
    case "collection": {
      const label = SECTIONS.find((section) => section.kind === page.id)?.title ?? "Apps";
      return <Listing source={{ kind: "collection", id: page.id, label }} />;
    }
    case "search":
      return <SearchPage query={page.query} />;
    case "entry":
      return <EntryPage entryKey={page.key} source={page.source} />;
    case "apps":
      return <AppsPage category={page.category} onCategory={(category) => replace({ kind: "apps", ...(category ? { category } : {}) })} />;
    case "extensions":
      return <ExtensionsPage />;
    case "widgets":
      return <WidgetsPage />;
    case "app":
      return <AppPage id={page.id} />;
    case "installed":
      return <Installed query={query} />;
    case "updates":
      return <Updates onRestart={onRestart} onUpdateSystem={onUpdateSystem} onLogOut={onLogOut} />;
    case "applets":
      return <AppletsPage />;
    case "applet":
      return <AppletPage id={page.id} />;
  }
}
