/**
 * A category's apps, a collection in full, or search results: cards in a
 * grid, a page at a time ("Show more"). A search is one search: the menu bar
 * applets that match come first (the catalog is local), then Flathub's apps.
 */

import { Button, EmptyState, glyphs, Loading } from "@dashi/ui";
import { ScrollView, View } from "@mirinjs/metal";
import { useEffect, useRef, useState } from "react";
import type { Answer, AppSummary, CategoryId, Collection, Flathub, Page } from "../../src/shared/software/index.ts";
import { AppletGroup, useAppletState } from "./applets/rows.tsx";
import { CardGrid } from "./cards.tsx";
import { SectionHeader } from "./heading.tsx";
import { useLoad } from "./hooks.ts";
import { matches } from "./nav.ts";
import { useServices } from "./services.ts";
import { Failed } from "./states.tsx";

const PER_PAGE = 24;

export type Source =
  | { kind: "category"; id: CategoryId; label: string }
  | { kind: "collection"; id: Collection; label: string }
  | { kind: "search"; query: string };

const fetchPage = (catalog: Flathub, source: Source, page: number): Promise<Answer<Page>> =>
  source.kind === "category"
    ? catalog.category(source.id, page, PER_PAGE)
    : source.kind === "collection"
      ? catalog.collection(source.id, page, PER_PAGE)
      : catalog.search(source.query, page, PER_PAGE);

/** The applets a search finds, by name, summary, author or id. */
function useAppletMatches(source: Source) {
  const state = useAppletState();
  if (source.kind !== "search" || state.index === null) return [];
  return state.index.applets.filter((entry) =>
    matches(source.query, { name: entry.manifest.name, summary: entry.manifest.summary, author: entry.manifest.author.name, id: entry.manifest.id }),
  );
}

export function Listing({ source }: { source: Source }) {
  const { catalog } = useServices();
  const key = source.kind === "search" ? `search:${source.query}` : `${source.kind}:${source.id}`;
  const first = useLoad<Page>(key, () => fetchPage(catalog, source, 1));
  const applets = useAppletMatches(source);
  const [more, setMore] = useState<{ key: string; apps: AppSummary[]; page: number; loading: boolean }>({ key, apps: [], page: 1, loading: false });
  const current = useRef(key);
  current.current = key;
  useEffect(() => setMore({ key, apps: [], page: 1, loading: false }), [key]);

  if (first.state.status === "loading") return <Loading label={source.kind === "search" ? "Searching…" : "Loading…"} />;
  // Flathub failing still shows the applets that match.
  if (first.state.status === "failed" && applets.length === 0) return <Failed state={first.state} onRetry={first.reload} />;
  const page = first.state.status === "ready" ? first.state.value : { apps: [], page: 1, totalPages: 1, total: 0 };
  const extra = more.key === key ? more : { key, apps: [], page: 1, loading: false };
  const seen = new Set(page.apps.map((app) => app.id));
  const apps = [...page.apps, ...extra.apps.filter((app) => !seen.has(app.id))];
  const hasMore = extra.page < page.totalPages;
  const title = source.kind === "search" ? `Apps for “${source.query}”` : source.label;

  const showMore = (): void => {
    if (extra.loading) return;
    const next = extra.page + 1;
    setMore({ ...extra, loading: true });
    void fetchPage(catalog, source, next)
      .then((answer) => current.current === key && setMore({ key, apps: [...extra.apps, ...answer.value.apps], page: next, loading: false }))
      .catch(() => current.current === key && setMore({ ...extra, loading: false }));
  };

  if (apps.length === 0 && applets.length === 0) {
    return (
      <EmptyState
        testID="no-results"
        glyph={glyphs.SEARCH}
        title="No results"
        message={
          source.kind === "search"
            ? `Nothing in Flathub or the applets matches “${source.query}”. Check the spelling or try fewer words.`
            : "There are no apps here yet."
        }
      />
    );
  }
  return (
    <ScrollView testID="listing" style={{ flex: 1, flexDirection: "column", gap: 14, padding: 22 }}>
      <AppletGroup title="Menu bar applets" entries={applets} testID="applet-results" />
      {apps.length > 0 && (
        <SectionHeader title={title} detail={page.total > 0 ? `${page.total.toLocaleString("en-US")} ${page.total === 1 ? "app" : "apps"}` : undefined} />
      )}
      {apps.length > 0 && <CardGrid apps={apps} />}
      {hasMore && (
        <View style={{ flexShrink: 0, alignItems: "center", padding: 8 }}>
          <Button label={extra.loading ? "Loading…" : "Show more"} testID="show-more" onPress={showMore} disabled={extra.loading} />
        </View>
      )}
    </ScrollView>
  );
}
