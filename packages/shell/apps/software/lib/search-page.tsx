/**
 * Search, from the catalog on this computer: every source at once, offline,
 * on every key (D320). Apps first, one card per app with the source it would
 * come from and the others that have it; then add-ons (menu bar applets and
 * launcher extensions) from Dashi's catalog; then "In Terminal", the
 * command-line tools whose package name matches.
 */

import { EmptyState, glyphs, Loading } from "@dashi/ui";
import { ScrollView } from "@mirinjs/metal";
import { AppletGroup, useAppletState } from "./applets/rows.tsx";
import { useCatalog } from "./catalog-hooks.ts";
import { EntryGrid, ToolRows } from "./entry-rows.tsx";
import { SectionHeader } from "./heading.tsx";
import { matches } from "./nav.ts";
import { useServices } from "./services.ts";
import { isExtension } from "./shelves.tsx";

function useAddOnMatches(query: string) {
  const state = useAppletState();
  if (state.index === null) return { applets: [], extensions: [] };
  const found = state.index.applets.filter((entry) =>
    matches(query, { name: entry.manifest.name, summary: entry.manifest.summary, author: entry.manifest.author.name, id: entry.manifest.id }),
  );
  return { applets: found.filter((entry) => !isExtension(entry)), extensions: found.filter(isExtension) };
}

export function SearchPage({ query }: { query: string }) {
  const { index } = useServices();
  const data = useCatalog();
  const addOns = useAddOnMatches(query);
  if (data === null) return <Loading label="Reading the catalog…" />;
  const { apps, tools } = index.search(query);
  if (apps.length === 0 && tools.length === 0 && addOns.applets.length === 0 && addOns.extensions.length === 0) {
    return (
      <EmptyState
        testID="no-results"
        glyph={glyphs.SEARCH}
        title="No results"
        message={`Nothing in Flathub, Fedora, Terra, your other sources or Dashi’s add-ons matches “${query}”. Check the spelling or try fewer words.`}
      />
    );
  }
  return (
    <ScrollView testID="search-results" style={{ flex: 1, flexDirection: "column", gap: 14, padding: 22 }}>
      {apps.length > 0 && (
        <SectionHeader
          title={`Apps for “${query}”`}
          detail={`${apps.length} ${apps.length === 1 ? "app" : "apps"} · found in this computer’s own catalog, across every source`}
        />
      )}
      {apps.length > 0 && <EntryGrid entries={apps} sources={data.sources} />}
      <AppletGroup title="Launcher extensions" entries={addOns.extensions} testID="extension-results" />
      <AppletGroup title="Menu bar applets" entries={addOns.applets} testID="applet-results" />
      {tools.length > 0 && <SectionHeader title="In Terminal" detail="Command-line tools whose name matches" />}
      {tools.length > 0 && <ToolRows entries={tools.slice(0, 8)} sources={data.sources} />}
    </ScrollView>
  );
}
