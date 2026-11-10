/** The page for where the window is: a sidebar place, a list, an app's or an applet's page. */

import { EmptyState, glyphs } from "@dashi/ui";
import { useSyncExternalStore } from "react";
import { CATEGORIES, type Collection } from "../../src/shared/software/index.ts";
import { AppPage } from "./app-page.tsx";
import { AppletPage } from "./applets/page.tsx";
import { AppletsPage } from "./applets/pages.tsx";
import { Discover, SECTIONS } from "./discover.tsx";
import { Installed } from "./installed.tsx";
import { Listing } from "./listing.tsx";
import type { Nav } from "./nav.ts";
import { useServices } from "./services.ts";
import { Updates } from "./updates.tsx";

export interface PageViewProps {
  nav: Nav;
  query: string;
  onRestart: () => void;
  onUpdateSystem: () => void;
  onSeeAll: (place: Collection | "applets") => void;
}

export function PageView({ nav, query, onRestart, onUpdateSystem, onSeeAll }: PageViewProps) {
  const { store } = useServices();
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const { page } = nav;
  const flathub = page.kind === "discover" || page.kind === "category" || page.kind === "collection" || page.kind === "app";
  if (flathub && !state.hasFlatpak) {
    return (
      <EmptyState
        testID="no-flatpak"
        glyph={glyphs.WARNING}
        title="Flatpak isn’t installed"
        message="Software installs apps with Flatpak. Install the flatpak package, then open Software again."
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
      return <Listing source={{ kind: "search", query: page.query }} />;
    case "app":
      return <AppPage id={page.id} />;
    case "installed":
      return <Installed query={query} />;
    case "updates":
      return <Updates onRestart={onRestart} onUpdateSystem={onUpdateSystem} />;
    case "applets":
      return <AppletsPage />;
    case "applet":
      return <AppletPage id={page.id} />;
  }
}
